import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MseStreamController,
  OPUS_WEBM_MIME,
  mseSupported,
  type MediaSourceLike,
  type MseElementLike,
  type SourceBufferLike,
  type TimeRangesLike,
} from "./mse-stream-controller.ts";

class FakeTimeRanges implements TimeRangesLike {
  constructor(public ranges: Array<[number, number]> = []) {}
  get length(): number {
    return this.ranges.length;
  }
  start(i: number): number {
    return this.ranges[i]![0];
  }
  end(i: number): number {
    return this.ranges[i]![1];
  }
}

class FakeElement implements MseElementLike {
  src = "";
  currentTime = 0;
  paused = true;
  seeking = false;
  playbackRate = 1;
  preservesPitch = false;
  buffered = new FakeTimeRanges();
  playCalls = 0;
  pauseCalls = 0;
  failNextPlay = false;
  private readonly handlers = new Map<string, Set<(event: Event) => void>>();

  play(): Promise<void> {
    this.playCalls++;
    if (this.failNextPlay) {
      this.failNextPlay = false;
      return Promise.reject(new Error("NotAllowedError"));
    }
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.pauseCalls++;
    this.paused = true;
  }
  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(listener);
    this.handlers.set(type, set);
  }
  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.handlers.get(type)?.delete(listener);
  }
  emit(type: string): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(new Event(type));
  }
  get handlerCount(): number {
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }
  /** What the media pipeline would report after the next append lands. */
  bufferedAfterAppend: Array<[number, number]> | null = null;
}

class FakeSourceBuffer implements SourceBufferLike {
  updating = false;
  readonly appends: Uint8Array[] = [];
  readonly removes: Array<[number, number]> = [];
  private readonly handlers = new Map<string, Set<(event: Event) => void>>();

  constructor(private readonly element: FakeElement) {}

  appendBuffer(data: BufferSource): void {
    if (this.updating) throw new Error("InvalidStateError");
    this.updating = true;
    this.appends.push(data as Uint8Array);
  }
  remove(start: number, end: number): void {
    if (this.updating) throw new Error("InvalidStateError");
    this.updating = true;
    this.removes.push([start, end]);
  }
  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(listener);
    this.handlers.set(type, set);
  }
  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.handlers.get(type)?.delete(listener);
  }
  /** The pipeline finished the pending append/remove: publish new ranges, fire updateend. */
  finish(ranges?: Array<[number, number]>): void {
    this.updating = false;
    if (ranges) this.element.buffered = new FakeTimeRanges(ranges);
    for (const fn of [...(this.handlers.get("updateend") ?? [])]) fn(new Event("updateend"));
  }
  emit(type: string): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(new Event(type));
  }
}

class FakeMediaSource implements MediaSourceLike {
  readyState = "closed";
  readonly mimes: string[] = [];
  readonly buffers: FakeSourceBuffer[] = [];
  private readonly handlers = new Map<string, Set<(event: Event) => void>>();

  constructor(private readonly element: FakeElement) {}

  addSourceBuffer(mime: string): SourceBufferLike {
    this.mimes.push(mime);
    const sb = new FakeSourceBuffer(this.element);
    this.buffers.push(sb);
    return sb;
  }
  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(listener);
    this.handlers.set(type, set);
  }
  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.handlers.get(type)?.delete(listener);
  }
  open(): void {
    this.readyState = "open";
    for (const fn of [...(this.handlers.get("sourceopen") ?? [])]) fn(new Event("sourceopen"));
  }
}

/** A hand-cranked fetch body: the test decides when bytes, the end, or an error arrive. */
class FakeReader {
  private readonly waiting: Array<(r: ReadableStreamReadResult<Uint8Array>) => void> = [];
  private readonly ready: Array<() => ReadableStreamReadResult<Uint8Array>> = [];
  private failure: Error | undefined;
  private readonly failWaiting: Array<(err: Error) => void> = [];
  cancelled = false;

  read(): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (this.failure) return Promise.reject(this.failure);
    const next = this.ready.shift();
    if (next) return Promise.resolve(next());
    return new Promise((resolve, reject) => {
      this.waiting.push(resolve);
      this.failWaiting.push(reject);
    });
  }
  cancel(): Promise<void> {
    this.cancelled = true;
    return Promise.resolve();
  }
  push(bytes: number[]): void {
    this.deliver(() => ({ value: new Uint8Array(bytes), done: false }));
  }
  end(): void {
    this.deliver(() => ({ value: undefined, done: true }));
  }
  fail(err: Error): void {
    this.failure = err;
    for (const reject of this.failWaiting.splice(0)) reject(err);
    this.waiting.length = 0;
  }
  private deliver(make: () => ReadableStreamReadResult<Uint8Array>): void {
    const resolve = this.waiting.shift();
    this.failWaiting.shift();
    if (resolve) resolve(make());
    else this.ready.push(make);
  }
}

interface Harness {
  element: FakeElement;
  controller: MseStreamController;
  sources: FakeMediaSource[];
  readers: FakeReader[];
  fetchCalls: Array<{ url: string; signal: AbortSignal | undefined }>;
  urls: string[];
  revoked: string[];
  /** Last MediaSource, opened, with its SourceBuffer and reader ready. */
  session(): { source: FakeMediaSource; sb: FakeSourceBuffer; reader: FakeReader };
}

function setup(
  overrides: Partial<ConstructorParameters<typeof MseStreamController>[0]> = {},
): Harness {
  const element = new FakeElement();
  const sources: FakeMediaSource[] = [];
  const readers: FakeReader[] = [];
  const fetchCalls: Harness["fetchCalls"] = [];
  const urls: string[] = [];
  const revoked: string[] = [];
  let tick = 1_000;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), signal: init?.signal ?? undefined });
    const reader = new FakeReader();
    readers.push(reader);
    init?.signal?.addEventListener("abort", () =>
      reader.fail(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
    return {
      ok: true,
      status: 200,
      body: { getReader: () => reader },
    } as unknown as Response;
  }) as typeof fetch;

  const controller = new MseStreamController({
    element,
    httpBaseUrl: "http://192.168.1.4:8080",
    lang: "es",
    now: () => ++tick,
    createMediaSource: () => {
      const source = new FakeMediaSource(element);
      sources.push(source);
      return source;
    },
    createObjectUrl: () => {
      const url = `blob:fake-${urls.length + 1}`;
      urls.push(url);
      return url;
    },
    revokeObjectUrl: (url) => {
      revoked.push(url);
    },
    fetchImpl,
    targetLagSec: 1,
    maxTargetLagSec: 3,
    lagStepSec: 0.5,
    catchUpSlackSec: 1.5,
    keepBehindSec: 30,
    governorMs: 1_000,
    recoveryDelayMs: 1_000,
    ...overrides,
  });

  return {
    element,
    controller,
    sources,
    readers,
    fetchCalls,
    urls,
    revoked,
    session() {
      const source = sources[sources.length - 1]!;
      return { source, sb: source.buffers[0]!, reader: readers[readers.length - 1]! };
    },
  } as Harness;
}

/** Drives a fresh session to the point where bytes can flow: open + fetch issued. */
async function ready(h: Harness): Promise<ReturnType<Harness["session"]>> {
  h.sources[h.sources.length - 1]!.open();
  await flush();
  return h.session();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("mseSupported", () => {
  test("is false without a MediaSource constructor at all", () => {
    expect(mseSupported(undefined)).toBe(false);
  });

  test("is false when the browser cannot demux Opus in WebM", () => {
    const ctor = Object.assign(function () {}, { isTypeSupported: () => false });
    expect(mseSupported(ctor)).toBe(false);
  });

  test("is true only when this exact stream type is playable", () => {
    const asked: string[] = [];
    const ctor = Object.assign(function () {}, {
      isTypeSupported: (mime: string) => {
        asked.push(mime);
        return true;
      },
    });
    expect(mseSupported(ctor)).toBe(true);
    expect(asked).toEqual([OPUS_WEBM_MIME]);
  });
});

describe("MseStreamController", () => {
  test("start attaches a MediaSource and calls play in the same tick", () => {
    const h = setup();

    // Not awaited on purpose: iOS-style gesture rules mean play() must already
    // have been called by the time start() returns, before any data exists.
    void h.controller.start();

    expect(h.element.src).toBe("blob:fake-1");
    expect(h.element.playCalls).toBe(1);
    expect(h.sources).toHaveLength(1);
  });

  test("opens an Opus/WebM buffer once the source opens, then streams the lane", async () => {
    const h = setup();
    void h.controller.start();

    const { source } = await ready(h);

    expect(source.mimes).toEqual([OPUS_WEBM_MIME]);
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0]!.url).toMatch(/^http:\/\/192\.168\.1\.4:8080\/stream\/es\.webm\?t=\d+$/);
    expect(h.fetchCalls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  test("appends chunks in arrival order and never while the buffer is updating", async () => {
    const h = setup();
    void h.controller.start();
    const { sb, reader } = await ready(h);

    reader.push([1]);
    reader.push([2]);
    reader.push([3]);
    await flush();

    expect(sb.appends.map((a) => a[0])).toEqual([1]);
    sb.finish();
    await flush();
    expect(sb.appends.map((a) => a[0])).toEqual([1, 2]);
    sb.finish();
    await flush();
    expect(sb.appends.map((a) => a[0])).toEqual([1, 2, 3]);
  });

  test("starts one target-lag behind the newest audio it has, not at the oldest byte", async () => {
    const h = setup();
    void h.controller.start();
    const { sb, reader } = await ready(h);

    // The server's opening write: the init segment plus ~3 s of primed backlog.
    reader.push([1]);
    await flush();
    sb.finish([[100, 103.07]]);

    expect(h.element.currentTime).toBeCloseTo(102.07, 3);
  });

  test("waits until a full target of runway exists before positioning", async () => {
    const h = setup();
    void h.controller.start();
    const { sb, reader } = await ready(h);

    reader.push([1]);
    await flush();
    sb.finish([[100, 100.5]]);
    expect(h.element.currentTime).toBe(0);

    reader.push([2]);
    await flush();
    sb.finish([[100, 101.2]]);
    expect(h.element.currentTime).toBeCloseTo(100.2, 3);
  });

  test("skips forward when playback has fallen far behind the buffered edge", async () => {
    vi.useFakeTimers();
    const h = setup();
    void h.controller.start();
    const { sb, reader } = await ready(h);
    reader.push([1]);
    await flush();
    sb.finish([[100, 103]]);

    // A background-tab pause left the playhead 5 s behind: past target + slack.
    h.element.buffered = new FakeTimeRanges([[100, 120]]);
    h.element.currentTime = 115;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.element.currentTime).toBeCloseTo(119, 3);
  });

  test("leaves ordinary lag alone", async () => {
    vi.useFakeTimers();
    const h = setup();
    void h.controller.start();
    const { sb, reader } = await ready(h);
    reader.push([1]);
    await flush();
    sb.finish([[100, 103]]);

    h.element.buffered = new FakeTimeRanges([[100, 120]]);
    h.element.currentTime = 118.9; // 1.1 s behind: inside the rate slack
    await vi.advanceTimersByTimeAsync(3_000);

    expect(h.element.currentTime).toBe(118.9);
    expect(h.element.playbackRate).toBe(1);
  });

  test("an underrun pauses, widens the target and resumes once the runway is back", async () => {
    const h = setup();
    void h.controller.start();
    const { sb, reader } = await ready(h);
    reader.push([1]);
    await flush();
    sb.finish([[100, 103]]);
    await flush();
    h.element.emit("playing");
    expect(h.controller.status).toBe("playing");

    // The playhead caught the buffered edge on venue wifi.
    h.element.currentTime = 103;
    h.element.emit("waiting");

    expect(h.element.pauseCalls).toBe(1);
    expect(h.controller.status).toBe("stalled");
    expect(h.element.playCalls).toBe(1);

    // Data trickles back in; not enough runway yet for the widened 1.5 s target.
    reader.push([2]);
    await flush();
    sb.finish([[100, 104]]);
    expect(h.element.playCalls).toBe(1);

    reader.push([3]);
    await flush();
    sb.finish([[100, 104.6]]);
    expect(h.element.playCalls).toBe(2);
    h.element.emit("playing");
    expect(h.controller.status).toBe("playing");
  });

  test("a waiting event fired by its own seek is not an underrun", async () => {
    const h = setup();
    void h.controller.start();
    const { sb, reader } = await ready(h);
    reader.push([1]);
    await flush();
    sb.finish([[100, 103]]);

    h.element.seeking = true;
    h.element.emit("waiting");

    expect(h.element.pauseCalls).toBe(0);
  });

  test("trims audio more than keepBehind seconds behind the playhead", async () => {
    vi.useFakeTimers();
    const h = setup();
    void h.controller.start();
    const { sb, reader } = await ready(h);
    reader.push([1]);
    await flush();
    sb.finish([[0, 3]]);

    h.element.buffered = new FakeTimeRanges([[0, 100]]);
    h.element.currentTime = 99;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(sb.removes).toEqual([[0, 69]]);
  });

  test("mute aborts the download and pauses; unmute opens a fresh session", async () => {
    const h = setup();
    void h.controller.start();
    const { reader } = await ready(h);

    h.controller.mute();

    expect(h.fetchCalls[0]!.signal!.aborted).toBe(true);
    expect(reader.cancelled || h.fetchCalls[0]!.signal!.aborted).toBe(true);
    expect(h.element.pauseCalls).toBe(1);
    expect(h.controller.status).toBe("muted");
    expect(h.controller.isMuted).toBe(true);
    expect(h.revoked).toEqual(["blob:fake-1"]);

    await h.controller.unmute();

    expect(h.sources).toHaveLength(2);
    expect(h.element.src).toBe("blob:fake-2");
    expect(h.element.playCalls).toBe(2);
    expect(h.controller.isMuted).toBe(false);
  });

  test("the server ending the stream rejoins at once", async () => {
    const h = setup();
    void h.controller.start();
    const { reader } = await ready(h);

    reader.end();
    await flush();

    expect(h.sources).toHaveLength(2);
    expect(h.element.src).toBe("blob:fake-2");
  });

  test("a network failure reports stalled and rejoins after the recovery delay", async () => {
    vi.useFakeTimers();
    const h = setup();
    void h.controller.start();
    const { reader } = await ready(h);

    reader.fail(new Error("wifi dead spot"));
    await flush();

    expect(h.controller.status).toBe("stalled");
    expect(h.sources).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.sources).toHaveLength(2);
  });

  test("a media element error rejoins after the recovery delay", async () => {
    vi.useFakeTimers();
    const h = setup();
    void h.controller.start();
    await ready(h);

    h.element.emit("error");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.sources).toHaveLength(2);
  });

  test("a buffer the pipeline rejects rejoins rather than wedging", async () => {
    vi.useFakeTimers();
    const h = setup();
    void h.controller.start();
    const { sb } = await ready(h);

    sb.emit("error");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.sources).toHaveLength(2);
  });

  test("a rejected play reports failed, so the UI can prompt for a tap", async () => {
    const h = setup();
    h.element.failNextPlay = true;

    await h.controller.start();

    expect(h.controller.status).toBe("failed");
  });

  test("status changes reach subscribers until they unsubscribe", async () => {
    const h = setup();
    const seen: string[] = [];
    const off = h.controller.onStatusChange((status) => seen.push(status));

    await h.controller.start();
    h.controller.mute();
    off();
    await h.controller.unmute();

    expect(seen).toEqual(["playing", "muted"]);
  });

  test("destroy aborts the download, detaches every listener and pauses", async () => {
    vi.useFakeTimers();
    const h = setup();
    void h.controller.start();
    await ready(h);

    h.controller.destroy();

    expect(h.fetchCalls[0]!.signal!.aborted).toBe(true);
    expect(h.element.handlerCount).toBe(0);
    expect(h.element.pauseCalls).toBe(1);
    expect(h.controller.status).toBe("idle");
    // Nothing left ticking: no governor, no recovery, no rejoin.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.sources).toHaveLength(1);
  });

  test("a chunk arriving for a session that was already torn down is ignored", async () => {
    const h = setup();
    void h.controller.start();
    const { sb, reader } = await ready(h);

    h.controller.mute();
    reader.push([9]);
    await flush();

    expect(sb.appends).toHaveLength(0);
  });
});

// Lag is held to the target continuously, not just at the start. A seek is a
// seam in the audio, so it is spent only on a large drift; small drift — the
// ~250 ms between placing the playhead and play() actually starting, or a
// stall that Chrome recovered from on its own — is absorbed by playing a few
// percent faster with the pitch preserved, which nobody in a hall can hear.
describe("MseStreamController lag control", () => {
  test("the default target holds playback 0.6 s behind the newest audio", async () => {
    const h = setup({ targetLagSec: undefined });
    void h.controller.start();
    const { sb, reader } = await ready(h);

    reader.push([1]);
    await flush();
    sb.finish([[100, 103.07]]);

    expect(h.element.currentTime).toBeCloseTo(102.47, 3);
  });

  test("absorbs a small drift with a faster rate, not a seek", async () => {
    vi.useFakeTimers();
    const h = setup();
    void h.controller.start();
    const { sb, reader } = await ready(h);
    reader.push([1]);
    await flush();
    sb.finish([[100, 103]]);

    h.element.buffered = new FakeTimeRanges([[100, 120]]);
    h.element.currentTime = 118.6; // 1.4 s behind: past the rate slack, inside the seek slack
    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.element.playbackRate).toBeCloseTo(1.05, 3);
    expect(h.element.currentTime).toBe(118.6);

    // Back on target: normal speed again.
    h.element.currentTime = 119.02;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.element.playbackRate).toBe(1);
  });

  // The runway widens on every underrun and, until now, never narrowed:
  // one hiccup at the door cost a phone half a second of latency for the rest
  // of a two-hour event, and five of them put it three seconds behind the
  // room for good. Recovery is deliberately slow and stepwise, so a phone in
  // a bad spot settles at whatever runway actually holds there rather than
  // bouncing between stalls and the floor.
  test("a widened target narrows back one step at a time once playback has been stable", async () => {
    vi.useFakeTimers();
    let clock = 10_000;
    const h = setup({
      now: () => clock,
      targetLagSec: 1,
      lagStepSec: 0.5,
      lagRecoverAfterMs: 60_000,
      lagRecoverStepSec: 0.25,
    });
    void h.controller.start();
    const { sb, reader } = await ready(h);
    reader.push([1]);
    await flush();
    sb.finish([[100, 103]]);
    expect(h.controller.targetLagSeconds).toBe(1);

    h.element.currentTime = 103;
    h.element.emit("waiting");
    expect(h.controller.targetLagSeconds).toBe(1.5);
    sb.finish([[100, 105]]);
    h.element.emit("playing");

    // Stable, but not for long enough yet.
    clock = 69_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.controller.targetLagSeconds).toBe(1.5);

    clock = 70_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.controller.targetLagSeconds).toBe(1.25);

    // One step per interval, not a slide.
    clock = 100_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.controller.targetLagSeconds).toBe(1.25);

    clock = 130_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.controller.targetLagSeconds).toBe(1);

    // Never below where it started.
    clock = 300_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.controller.targetLagSeconds).toBe(1);
  });

  test("another underrun restarts the recovery clock from the wider target", async () => {
    vi.useFakeTimers();
    let clock = 10_000;
    const h = setup({
      now: () => clock,
      targetLagSec: 1,
      lagStepSec: 0.5,
      lagRecoverAfterMs: 60_000,
      lagRecoverStepSec: 0.25,
    });
    void h.controller.start();
    const { sb, reader } = await ready(h);
    reader.push([1]);
    await flush();
    sb.finish([[100, 103]]);

    h.element.currentTime = 103;
    h.element.emit("waiting");
    sb.finish([[100, 105]]);
    h.element.emit("playing");

    clock = 50_000;
    h.element.currentTime = 105;
    h.element.emit("waiting");
    expect(h.controller.targetLagSeconds).toBe(2);
    sb.finish([[100, 108]]);
    h.element.emit("playing");

    // 60 s after the FIRST underrun is not yet 60 s after the second.
    clock = 70_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.controller.targetLagSeconds).toBe(2);

    clock = 110_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.controller.targetLagSeconds).toBe(1.75);
  });

  test("preserves pitch so the catch-up rate does not shift the voice", () => {
    const h = setup();
    void h.controller.start();
    expect(h.element.preservesPitch).toBe(true);
  });

  test("a catch-up in progress is dropped by mute and by an underrun", async () => {
    vi.useFakeTimers();
    const h = setup();
    void h.controller.start();
    const { sb, reader } = await ready(h);
    reader.push([1]);
    await flush();
    sb.finish([[100, 103]]);
    h.element.buffered = new FakeTimeRanges([[100, 120]]);
    h.element.currentTime = 118.6;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.element.playbackRate).toBeCloseTo(1.05, 3);

    h.element.currentTime = 120;
    h.element.emit("waiting");
    expect(h.element.playbackRate).toBe(1);

    h.element.playbackRate = 1.05;
    h.controller.mute();
    expect(h.element.playbackRate).toBe(1);
  });
});
