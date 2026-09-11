import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AudioStreamController,
  maxDriftSecFor,
  streamUrl,
  type AudioElementLike,
} from "./audio-stream-controller.ts";

class FakeAudioElement implements AudioElementLike {
  src = "";
  paused = true;
  currentTime = 0;
  loadCalls = 0;
  pauseCalls = 0;
  failNextPlay = false;
  /** The src as it stood at each play() call. */
  readonly playCalls: string[] = [];

  private readonly handlers = new Map<string, Set<(event: Event) => void>>();

  play(): Promise<void> {
    this.playCalls.push(this.src);
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

  load(): void {
    this.loadCalls++;
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
}

function setup() {
  const element = new FakeAudioElement();
  let tick = 1_000;
  const controller = new AudioStreamController({
    element,
    httpBaseUrl: "http://192.168.1.4:8080",
    lang: "es",
    now: () => ++tick,
    recoveryDelayMs: 1_000,
  });
  return { element, controller };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("streamUrl", () => {
  test("points at the language stream with a cache-buster", () => {
    expect(streamUrl("http://192.168.1.4:8080", "ja", 42)).toBe(
      "http://192.168.1.4:8080/stream/ja.webm?t=42",
    );
  });
});

describe("AudioStreamController", () => {
  test("start sets the src and calls play in the same tick", () => {
    const { element, controller } = setup();

    // Deliberately not awaited: iOS grants playback only from inside the tap
    // that triggered it, so play() must already have been called by the time
    // start() returns.
    void controller.start();

    expect(element.playCalls).toHaveLength(1);
    expect(element.src).toMatch(
      /^http:\/\/192\.168\.1\.4:8080\/stream\/es\.webm\?t=\d+$/,
    );
  });

  test("mute pauses the element without touching the src", async () => {
    const { element, controller } = setup();
    await controller.start();
    const before = element.src;

    controller.mute();

    expect(element.pauseCalls).toBe(1);
    expect(element.src).toBe(before);
    expect(controller.status).toBe("muted");
    expect(controller.isMuted).toBe(true);
  });

  test("unmute re-requests a different URL and reloads", async () => {
    const { element, controller } = setup();
    await controller.start();
    const first = element.src;

    controller.mute();
    await controller.unmute();

    expect(element.src).not.toBe(first);
    expect(element.loadCalls).toBe(1);
    expect(element.playCalls).toHaveLength(2);
    expect(controller.status).toBe("playing");
    expect(controller.isMuted).toBe(false);
  });

  test("the URL still changes when two rejoins land in the same millisecond", async () => {
    const element = new FakeAudioElement();
    const frozen = new AudioStreamController({
      element,
      httpBaseUrl: "http://192.168.1.4:8080",
      lang: "es",
      now: () => 5_000, // a clock that never moves
    });

    await frozen.start();
    const first = element.src;
    await frozen.unmute();

    expect(element.src).not.toBe(first);
  });

  // `stalled` is a network-progress heuristic, and rejoining on it is actively
  // harmful here: the server answers every new connection with the same primed
  // backlog, so a pause in ingest — or one WebSocket blip on the operator's
  // reconnect ladder, which backs off to 8 s — replays the last few seconds of
  // the speaker into every earpiece in the room, on repeat, until audio
  // resumes. Report it so the UI can say something, and wait.
  test("a stalled event reports status but does not re-request the stream", async () => {
    vi.useFakeTimers();
    const { element, controller } = setup();
    await controller.start();
    const first = element.src;

    element.emit("stalled");
    expect(controller.status).toBe("stalled");

    await vi.advanceTimersByTimeAsync(30_000);

    expect(element.src).toBe(first);
    expect(element.loadCalls).toBe(0);
  });

  test("recovering from a stall on its own returns to playing", async () => {
    vi.useFakeTimers();
    const { element, controller } = setup();
    await controller.start();
    const first = element.src;

    element.emit("stalled");
    element.emit("playing");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(element.src).toBe(first);
    expect(element.loadCalls).toBe(0);
    expect(controller.status).toBe("playing");
  });

  test("ended rejoins immediately, because the chunked response died", async () => {
    const { element, controller } = setup();
    await controller.start();
    const first = element.src;

    element.emit("ended");
    await Promise.resolve();

    expect(element.src).not.toBe(first);
    expect(element.loadCalls).toBe(1);
  });

  test("a rejected play reports failed, so the UI can prompt for a tap", async () => {
    const { element, controller } = setup();
    element.failNextPlay = true;

    await controller.start();

    expect(controller.status).toBe("failed");
  });

  test("mute while stalled leaves nothing pending", async () => {
    vi.useFakeTimers();
    const { element, controller } = setup();
    await controller.start();
    const first = element.src;

    element.emit("stalled");
    controller.mute();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(element.src).toBe(first);
    expect(element.loadCalls).toBe(0);
    expect(controller.status).toBe("muted");
  });

  test("status changes reach subscribers until they unsubscribe", async () => {
    const { controller } = setup();
    const seen: string[] = [];
    const off = controller.onStatusChange((status) => seen.push(status));

    await controller.start();
    controller.mute();
    off();
    await controller.unmute();

    expect(seen).toEqual(["playing", "muted"]);
  });

  test("destroy detaches every listener and pauses", async () => {
    const { element, controller } = setup();
    await controller.start();

    controller.destroy();

    expect(element.handlerCount).toBe(0);
    expect(element.pauseCalls).toBe(1);
    expect(controller.status).toBe("idle");
  });
});

// Playback runs at exactly 1.0x and can never catch up, so every stall adds its
// own duration to the listener's lag permanently. Left alone, a stream that
// starves occasionally drifts further behind the room all event. The ONLY
// reliable signal is the lane's own media clock from the server: `buffered.end`
// is the demuxer's read-ahead and tracks the playhead, so it can never reveal
// this.
describe("drift correction", () => {
  function driftSetup(liveSeconds: () => Promise<number | null>) {
    const element = new FakeAudioElement();
    let tick = 1_000;
    const controller = new AudioStreamController({
      element,
      httpBaseUrl: "http://192.168.1.4:8080",
      lang: "es",
      now: () => ++tick,
      recoveryDelayMs: 1_000,
      liveMediaSeconds: liveSeconds,
      driftCheckMs: 5_000,
      maxDriftSec: 8,
    });
    return { element, controller };
  }

  test("re-requests the stream when it has drifted far behind the lane's clock", async () => {
    vi.useFakeTimers();
    const { element, controller } = driftSetup(async () => 100);
    await controller.start();
    const first = element.src;
    element.currentTime = 85; // 15s behind live

    await vi.advanceTimersByTimeAsync(5_000);

    expect(element.src).not.toBe(first);
    expect(element.loadCalls).toBe(1);
  });

  test("leaves a normally-lagging listener alone", async () => {
    vi.useFakeTimers();
    const { element, controller } = driftSetup(async () => 100);
    await controller.start();
    const first = element.src;
    element.currentTime = 96.5; // 3.5s behind: the prime, working as intended

    await vi.advanceTimersByTimeAsync(30_000);

    expect(element.src).toBe(first);
    expect(element.loadCalls).toBe(0);
  });

  test("stops checking once destroyed", async () => {
    vi.useFakeTimers();
    const { element, controller } = driftSetup(async () => 100);
    await controller.start();
    element.currentTime = 0;
    controller.destroy();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(element.loadCalls).toBe(0);
  });
});

// The threshold used to be a constant written for a 3 s prime. The prime is
// derived from the bitrate on the server, and a 24 kbps default made it 16 s
// — past the constant — so every listener was restarted every 5 s, forever.
describe("maxDriftSecFor", () => {
  test("keeps the 8 s floor for a short or unknown prime", () => {
    expect(maxDriftSecFor(0)).toBe(8);
    expect(maxDriftSecFor(2_000)).toBe(8);
  });

  test("sits a fixed headroom above a long prime", () => {
    expect(maxDriftSecFor(16_384)).toBeCloseTo(21.384, 3);
  });
});
