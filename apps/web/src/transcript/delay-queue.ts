/**
 * Holds each item for a fixed delay before releasing it. This is the whole of
 * the spec's sync strategy: the transcript runs ahead of the audio by roughly
 * the <audio> buffer depth, so TRANSCRIPT_DELAY_MS holds it back by a constant.
 *
 * A hold-and-release buffer keyed on audio position is the later upgrade, and
 * attaches exactly here without touching any caller.
 */
export class DelayQueue<T> {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly delayMs: number,
    private readonly emit: (item: T) => void,
  ) {}

  get pendingCount(): number {
    return this.timers.size;
  }

  push(item: T): void {
    // The default delay is 0. Emitting synchronously in that case keeps the UI
    // update in the same task as the socket message instead of pushing it to a
    // macrotask for no reason.
    if (this.delayMs <= 0) {
      this.emit(item);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.emit(item);
    }, this.delayMs);
    this.timers.add(timer);
  }

  clear(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
