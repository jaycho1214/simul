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
      this.entries.get(lang)?.subscribers.add(subscriber);
      return lane;
    }

    if (this.entries.size + this.opening.size >= this.opts.maxConcurrentLanes) {
      throw new LaneCapError(this.opts.maxConcurrentLanes);
    }

    const promise = this.openLane(lang);
    this.opening.set(lang, promise);

    try {
      const lane = await promise;
      this.entries.set(lang, {
        lane,
        subscribers: new Set([subscriber]),
        openedAt: this.opts.clock.now(),
      });
      this.opts.hub.addLane(lane);
      return lane;
    } finally {
      this.opening.delete(lang);
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
    if (!entry) return;

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
    for (const [lang, entry] of this.entries) {
      if (entry.closeTimer) this.opts.clock.clearTimeout(entry.closeTimer);
      this.opts.hub.removeLane(lang);
      entry.lane.close();
    }
    this.entries.clear();
  }
}
