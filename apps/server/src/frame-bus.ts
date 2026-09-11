export type FrameListener = (frame: Buffer, timestampMs: number) => void;

/**
 * Pub/sub for encoded Opus frames. The same Buffer object is handed to every
 * subscriber — encoding happens once per lane and is never copied per listener.
 * This is the seam where a future WebSocket audio sink attaches alongside
 * WebMSink.
 */
export class FrameBus {
  private readonly listeners = new Set<FrameListener>();

  get subscriberCount(): number {
    return this.listeners.size;
  }

  subscribe(fn: FrameListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  publish(frame: Buffer, timestampMs: number): void {
    for (const fn of this.listeners) {
      try {
        fn(frame, timestampMs);
      } catch (err) {
        console.error("frame subscriber threw", err);
      }
    }
  }
}
