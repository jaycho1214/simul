import type { LangCode } from "@simul/protocol";
import type { PcmConsumer } from "./lane/lane.ts";

/**
 * Broadcasts ingest PCM to every open lane. Lanes are isolated: one that throws
 * cannot affect ingest or any sibling.
 */
export class AudioHub {
  private readonly lanes = new Map<LangCode, PcmConsumer>();

  get laneCount(): number {
    return this.lanes.size;
  }

  addLane(consumer: PcmConsumer): void {
    if (this.lanes.has(consumer.lang)) {
      throw new Error(`AudioHub already has a lane for "${consumer.lang}"`);
    }
    this.lanes.set(consumer.lang, consumer);
  }

  removeLane(lang: LangCode): void {
    this.lanes.delete(lang);
  }

  push(frame: Buffer): void {
    for (const lane of this.lanes.values()) {
      try {
        lane.pushPcm(frame);
      } catch (err) {
        console.error(`lane ${lane.lang} threw on pushPcm`, err);
      }
    }
  }
}
