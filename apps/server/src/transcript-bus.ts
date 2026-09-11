import type { TranscriptLine } from "@simul/protocol";
import type { Clock } from "./clock.ts";

/**
 * Publishes transcript lines and retains the most recent finalised ones.
 * Interim lines are broadcast but never stored, so a reconnecting client
 * replays only settled text.
 */
export class TranscriptBus {
  private readonly listeners = new Set<(line: TranscriptLine) => void>();
  private readonly lines: TranscriptLine[] = [];
  private seq = 0;

  constructor(
    private readonly clock: Clock,
    private readonly historyLines: number,
  ) {}

  subscribe(fn: (line: TranscriptLine) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  history(): TranscriptLine[] {
    return [...this.lines];
  }

  /**
   * Publishes a transcript line. Sequence numbers are assigned unconditionally,
   * so interim lines (isFinal: false) consume sequence numbers even though they
   * are not stored in history.
   */
  publish(text: string, isFinal: boolean): TranscriptLine {
    const line = Object.freeze({
      seq: ++this.seq,
      text,
      isFinal,
      ts: this.clock.now(),
    }) as TranscriptLine;

    if (isFinal) {
      this.lines.push(line);
      while (this.lines.length > this.historyLines) this.lines.shift();
    }

    for (const fn of this.listeners) {
      try {
        fn(line);
      } catch (err) {
        console.error("transcript subscriber threw", err);
      }
    }
    return line;
  }
}
