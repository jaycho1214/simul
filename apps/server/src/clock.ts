export type TimerHandle = { readonly id: number };

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export class SystemClock implements Clock {
  private next = 1;
  private readonly timers = new Map<number, NodeJS.Timeout>();

  now(): number {
    return Date.now();
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.next++;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        fn();
      }, ms),
    );
    return { id };
  }

  clearTimeout(handle: TimerHandle): void {
    const t = this.timers.get(handle.id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(handle.id);
    }
  }
}

export class FakeClock implements Clock {
  private next = 1;
  private current: number;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  constructor(startMs = 0) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.next++;
    this.timers.set(id, { at: this.current + ms, fn });
    return { id };
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle.id);
  }

  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at);
      const first = due[0];
      if (!first) break;
      this.timers.delete(first[0]);
      this.current = first[1].at;
      first[1].fn();
    }
    this.current = target;
  }
}
