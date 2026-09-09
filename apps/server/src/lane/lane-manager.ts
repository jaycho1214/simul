import type { LangCode, LaneStatus } from "@tongyeok/protocol";
import type { Clock, TimerHandle } from "../clock.ts";
import type { AudioHub } from "../audio-hub.ts";
import type { TranslateSessionFactory } from "../gemini/translate-session.ts";
import type { Lane } from "./lane.ts";
import { SourceLane } from "./source-lane.ts";
import { TranslatedLane } from "./translated-lane.ts";

export class LaneCapError extends Error {
  constructor(max: number) {
    super(`lane cap of ${max} reached`);
    this.name = "LaneCapError";
  }
}

export class UnknownLanguageError extends Error {
  constructor(lang: string) {
    super(`language ${lang} is not offered`);
    this.name = "UnknownLanguageError";
  }
}

export interface LaneManagerOptions {
  clock: Clock;
  hub: AudioHub;
  sessionFactory: TranslateSessionFactory;
  sourceLanguage: LangCode;
  offeredLanguages: readonly LangCode[];
  maxConcurrentLanes: number;
  laneGraceMs: number;
  transcriptHistoryLines: number;
  opusBitrate: number;
}

interface Entry {
  lane: Lane;
  subscribers: Set<object>;
  openedAt: number;
  closeTimer?: TimerHandle;
}

export class LaneManager {
  private readonly entries = new Map<LangCode, Entry>();
  private readonly opening = new Map<LangCode, Promise<Lane>>();
  /**
   * Subscribers who called release() for a language while it was still
   * opening — i.e. before an Entry existed for `release` to act on. Gemini
   * session setup is real network I/O, so this is not a theoretical window:
   * an attendee can tap a language and back out again before the session
   * finishes opening. Without this, that release is silently dropped and
   * the acquire continuation re-adds the subscriber unconditionally once
   * the open resolves, leaving a subscriber that can never release again —
   * a lane that bills for the rest of the event with nobody listening.
   */
  private readonly pendingReleases = new Map<LangCode, Set<object>>();
  /** Set once by closeAll(). Permanent: this instance is done after that. */
  private closed = false;

  constructor(private readonly opts: LaneManagerOptions) {}

  get(lang: LangCode): Lane | undefined {
    return this.entries.get(lang)?.lane;
  }

  async acquire(lang: LangCode, subscriber: object): Promise<Lane> {
    if (!this.opts.offeredLanguages.includes(lang)) {
      throw new UnknownLanguageError(lang);
    }

    const existing = this.entries.get(lang);
    if (existing) {
      if (existing.closeTimer) {
        this.opts.clock.clearTimeout(existing.closeTimer);
        existing.closeTimer = undefined;
      }
      existing.subscribers.add(subscriber);
      return existing.lane;
    }

    // Collapse concurrent first-subscriber races onto one open.
    const inFlight = this.opening.get(lang);
    if (inFlight) {
      const lane = await inFlight;
      this.registerSubscriberAfterOpen(lang, subscriber);
      return lane;
    }

    if (this.entries.size + this.opening.size >= this.opts.maxConcurrentLanes) {
      throw new LaneCapError(this.opts.maxConcurrentLanes);
    }

    const promise = this.openLane(lang);
    this.opening.set(lang, promise);

    try {
      const lane = await promise;

      // closeAll() ran while this open was in flight. It couldn't touch
      // this lane — it wasn't in `entries` yet — so this is the only place
      // left to stop it from becoming a live, billing session that nothing
      // will ever release.
      if (this.closed) {
        lane.close();
        return lane;
      }

      this.entries.set(lang, {
        lane,
        subscribers: new Set(),
        openedAt: this.opts.clock.now(),
      });
      this.opts.hub.addLane(lane);
      this.registerSubscriberAfterOpen(lang, subscriber);
      return lane;
    } finally {
      this.opening.delete(lang);
    }
  }

  /**
   * Adds `subscriber` to a lane whose open just resolved — whether this
   * call is the one that opened it, or a concurrent acquire that joined an
   * already-in-flight open. Reconciles against a release() that arrived
   * for this subscriber while the open was still pending: if one did,
   * undoes the add immediately via the normal release() path (which starts
   * the grace timer if that leaves the lane with no subscribers at all)
   * instead of leaving a subscriber that will never release again.
   */
  private registerSubscriberAfterOpen(lang: LangCode, subscriber: object): void {
    const entry = this.entries.get(lang);
    if (!entry) return; // closeAll() ran; nothing to join.

    entry.subscribers.add(subscriber);

    const pending = this.pendingReleases.get(lang);
    if (pending?.delete(subscriber)) {
      if (pending.size === 0) this.pendingReleases.delete(lang);
      this.release(lang, subscriber);
    }
  }

  private async openLane(lang: LangCode): Promise<Lane> {
    if (lang === this.opts.sourceLanguage) {
      return new SourceLane(lang, this.opts.opusBitrate, this.opts.clock);
    }
    return TranslatedLane.create({
      lang,
      clock: this.opts.clock,
      opusBitrate: this.opts.opusBitrate,
      historyLines: this.opts.transcriptHistoryLines,
      sessionFactory: this.opts.sessionFactory,
    });
  }

  release(lang: LangCode, subscriber: object): void {
    const entry = this.entries.get(lang);
    if (!entry) {
      // No entry yet doesn't mean nothing to do: the lane may still be
      // opening. Record the release so acquire()'s continuation can
      // reconcile it instead of silently re-adding this subscriber once
      // the open resolves.
      if (this.opening.has(lang)) {
        let pending = this.pendingReleases.get(lang);
        if (!pending) {
          pending = new Set();
          this.pendingReleases.set(lang, pending);
        }
        pending.add(subscriber);
      }
      return;
    }

    entry.subscribers.delete(subscriber);
    if (entry.subscribers.size > 0 || entry.closeTimer) return;

    entry.closeTimer = this.opts.clock.setTimeout(() => {
      const current = this.entries.get(lang);
      if (!current || current.subscribers.size > 0) return;
      this.opts.hub.removeLane(lang);
      current.lane.close();
      this.entries.delete(lang);
    }, this.opts.laneGraceMs);
  }

  statuses(): LaneStatus[] {
    const now = this.opts.clock.now();
    return [...this.entries.entries()].map(([lang, entry]) => ({
      lang,
      listeners: entry.subscribers.size,
      state: entry.lane.state,
      laneDrops: entry.lane.laneDrops,
      listenerDrops: 0, // filled in by the stream route in Task 14
      ageMs: now - entry.openedAt,
    }));
  }

  closeAll(): void {
    this.closed = true;
    for (const [lang, entry] of this.entries) {
      if (entry.closeTimer) this.opts.clock.clearTimeout(entry.closeTimer);
      this.opts.hub.removeLane(lang);
      entry.lane.close();
    }
    this.entries.clear();
  }
}
