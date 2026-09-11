import type { LangCode, LaneStatus } from "@tongyeok/protocol";
import type { Clock, TimerHandle } from "../clock.ts";
import type { AudioHub } from "../audio-hub.ts";
import type { TranslateSessionFactory } from "../gemini/translate-session.ts";
import type { Lane } from "./lane.ts";
import { SourceLane } from "./source-lane.ts";
import { TranslatedLane } from "./translated-lane.ts";

/**
 * The lane that carries the room's own audio untranslated. Not a language:
 * it exists only while `passthroughLane` is on, as a way to check the capture
 * chain without a model in the path, and the attendee app lists it last,
 * tagged as debug. Every real language lane goes through the model, which
 * detects what is spoken and parrots speech already in the target language.
 */
export const PASSTHROUGH_LANG = "original";

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
  /** Offer PASSTHROUGH_LANG alongside the languages. */
  passthroughLane: boolean;
  offeredLanguages: readonly LangCode[];
  maxConcurrentLanes: number;
  laneGraceMs: number;
  transcriptHistoryLines: number;
  opusBitrate: number;
  /**
   * How much recent audio a joining listener is handed up front. See
   * `WebMSink.backlog` — a media element decodes nothing until it has
   * analysed several seconds of timestamped audio, so without this every
   * listener waits out that gate in silence.
   */
  streamPrimeMs: number;
}

/**
 * Which transport a subscriber holds. An attendee's phone opens one of each
 * for the same lane, so without this distinction the refcount counts sockets
 * and the operator dashboard reports double the head count. See
 * `LaneStatus.listeners`.
 */
export type LaneSubscriberKind = "audio" | "transcript";

interface Entry {
  lane: Lane;
  subscribers: Map<object, LaneSubscriberKind>;
  openedAt: number;
  closeTimer?: TimerHandle;
}

/**
 * One in-flight open for a language. `pendingReleases` is scoped to this
 * specific open attempt, not to the language: it is created fresh with the
 * open and discarded with it (success, failure, or closeAll()), so a
 * release recorded here can only ever be reconciled against the open it
 * was recorded during — never against a later, unrelated open for the same
 * language.
 */
interface Opening {
  promise: Promise<Lane>;
  pendingReleases: Set<object>;
}

export class LaneManager {
  private readonly entries = new Map<LangCode, Entry>();
  private readonly opening = new Map<LangCode, Opening>();
  /** Set once by closeAll(). Permanent: this instance is done after that. */
  private closed = false;

  constructor(private readonly opts: LaneManagerOptions) {}

  get(lang: LangCode): Lane | undefined {
    return this.entries.get(lang)?.lane;
  }

  async acquire(lang: LangCode, subscriber: object, kind: LaneSubscriberKind): Promise<Lane> {
    if (this.closed) {
      throw new Error("LaneManager is closed");
    }
    if (!this.isOffered(lang)) {
      throw new UnknownLanguageError(lang);
    }

    const existing = this.entries.get(lang);
    if (existing) {
      if (existing.closeTimer) {
        this.opts.clock.clearTimeout(existing.closeTimer);
        existing.closeTimer = undefined;
      }
      existing.subscribers.set(subscriber, kind);
      return existing.lane;
    }

    // Collapse concurrent first-subscriber races onto one open.
    const inFlight = this.opening.get(lang);
    if (inFlight) {
      const lane = await inFlight.promise;
      this.registerSubscriberAfterOpen(lang, subscriber, kind, inFlight);
      return lane;
    }

    if (this.entries.size + this.opening.size >= this.opts.maxConcurrentLanes) {
      throw new LaneCapError(this.opts.maxConcurrentLanes);
    }

    const opening: Opening = { promise: this.openLane(lang), pendingReleases: new Set() };
    this.opening.set(lang, opening);

    try {
      const lane = await opening.promise;

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
        subscribers: new Map(),
        openedAt: this.opts.clock.now(),
      });
      this.opts.hub.addLane(lane);
      this.registerSubscriberAfterOpen(lang, subscriber, kind, opening);
      return lane;
    } finally {
      this.opening.delete(lang);
    }
  }

  /**
   * Adds `subscriber` to a lane whose open just resolved — whether this
   * call is the one that opened it, or a concurrent acquire that joined an
   * already-in-flight open.
   *
   * Two things must happen together here, in order:
   *
   * 1. Clear any grace timer already sitting on the entry. A joiner who
   *    arrives after some other subscriber's early release already emptied
   *    the set (see release()) is exactly the case that arms one; leaving
   *    it running for `release()`'s "a timer is already pending" guard to
   *    trip on later — once this subscriber is the only one left and
   *    actually leaves — is the zombie-timer bug this method exists to
   *    prevent.
   * 2. Reconcile against a release() that arrived for this subscriber
   *    while this exact open was still pending (`opening.pendingReleases`,
   *    scoped to this open attempt, not the language). If one did, undo
   *    the add immediately via the normal release() path, which starts a
   *    fresh grace timer if that leaves the lane with no subscribers —
   *    instead of leaving a subscriber that will never release again.
   */
  private registerSubscriberAfterOpen(
    lang: LangCode,
    subscriber: object,
    kind: LaneSubscriberKind,
    opening: Opening,
  ): void {
    const entry = this.entries.get(lang);
    if (!entry) return; // closeAll() ran; nothing to join.

    if (entry.closeTimer) {
      this.opts.clock.clearTimeout(entry.closeTimer);
      entry.closeTimer = undefined;
    }
    entry.subscribers.set(subscriber, kind);

    if (opening.pendingReleases.delete(subscriber)) {
      this.release(lang, subscriber);
    }
  }

  private isOffered(lang: LangCode): boolean {
    if (lang === PASSTHROUGH_LANG) return this.opts.passthroughLane;
    return this.opts.offeredLanguages.includes(lang);
  }

  private async openLane(lang: LangCode): Promise<Lane> {
    if (lang === PASSTHROUGH_LANG) {
      return new SourceLane(lang, this.opts.opusBitrate, this.opts.clock, this.opts.streamPrimeMs);
    }
    return TranslatedLane.create({
      lang,
      clock: this.opts.clock,
      opusBitrate: this.opts.opusBitrate,
      historyLines: this.opts.transcriptHistoryLines,
      streamPrimeMs: this.opts.streamPrimeMs,
      sessionFactory: this.opts.sessionFactory,
    });
  }

  release(lang: LangCode, subscriber: object): void {
    const entry = this.entries.get(lang);
    if (!entry) {
      // No entry yet doesn't mean nothing to do: the lane may still be
      // opening. Record the release against that specific open (not just
      // the language) so acquire()'s continuation can reconcile it once
      // that open resolves, instead of silently re-adding this subscriber.
      // Scoping to the open itself, rather than a map keyed only by
      // language, means a stray release — one with no matching acquire in
      // this open, or one left over after a cap rejection — can never be
      // mistaken for part of some later, unrelated open of the same
      // language.
      this.opening.get(lang)?.pendingReleases.add(subscriber);
      return;
    }

    entry.subscribers.delete(subscriber);
    if (entry.subscribers.size > 0 || entry.closeTimer) return;

    entry.closeTimer = this.opts.clock.setTimeout(() => {
      const current = this.entries.get(lang);
      // This handle just fired, so it is spent either way: clear it before
      // the early return below, or a genuinely new subscriber who joined
      // and left after this fired (but while it was still armed) would find
      // `closeTimer` truthy and never get a real grace timer of their own.
      if (current) current.closeTimer = undefined;
      if (!current || current.subscribers.size > 0) return;
      this.opts.hub.removeLane(lang);
      current.lane.close();
      this.entries.delete(lang);
    }, this.opts.laneGraceMs);
  }

  statuses(): LaneStatus[] {
    const now = this.opts.clock.now();
    return [...this.entries.entries()].map(([lang, entry]) => {
      let audioListeners = 0;
      let transcriptListeners = 0;
      for (const kind of entry.subscribers.values()) {
        if (kind === "audio") audioListeners++;
        else transcriptListeners++;
      }
      return {
        lang,
        // Not the sum: an attendee holds one of each, so adding them counts
        // every person twice. See `LaneStatus.listeners`.
        listeners: Math.max(audioListeners, transcriptListeners),
        audioListeners,
        state: entry.lane.state,
        laneDrops: entry.lane.laneDrops,
        listenerDrops: 0, // filled in by the stream route in Task 14
        ageMs: now - entry.openedAt,
      };
    });
  }

  closeAll(): void {
    this.closed = true;
    for (const [lang, entry] of this.entries) {
      if (entry.closeTimer) this.opts.clock.clearTimeout(entry.closeTimer);
      this.opts.hub.removeLane(lang);
      entry.lane.close();
    }
    this.entries.clear();
    // Any opens still in flight finish on their own (see the `this.closed`
    // check in acquire()) and are inert once they do; this just drops our
    // own references to their now-moot pendingReleases sets right away
    // rather than waiting on that.
    this.opening.clear();
  }
}
