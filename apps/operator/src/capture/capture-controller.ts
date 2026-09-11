// A URL to a file, never inlined: vite.renderer.config.mts excludes the
// worklet from `assetsInlineLimit`, because the packaged window's
// `script-src 'self'` refuses a data: module and addModule() fails with
// "Unable to load a worklet's module" — as it did on the venue laptop.
import workletUrl from "./pcm-tap.worklet.js?url";
import { buildDeviceReport, clampChannelIndex, type DeviceReport } from "./device-report.ts";
import { FrameAccumulator } from "./frame-accumulator.ts";
import { describeCaptureCause } from "./capture-errors.ts";
import { clampGainDb, dbToLinear } from "./gain.ts";
import { IngestSocket, ingestUrl } from "./ingest-socket.ts";
import { NoiseProfiler, NoiseReducer, type NoiseProfile } from "./noise-reducer.ts";
import { floatTo16BitPcm } from "./pcm.ts";
import { measureLevel, type LevelReading } from "./level.ts";
import type { ConnectionState, SocketLike } from "../net/reconnecting-socket.ts";

export interface InputDevice {
  deviceId: string;
  label: string;
}

export type CaptureError =
  /** `name` is the DOMException's — see capture-errors.ts for what each one means. */
  | { code: "deviceOpenFailed"; name: string; reason: string }
  | { code: "deviceLost" }
  | { code: "workletFailed"; name: string; reason: string };

export interface CaptureSnapshot {
  running: boolean;
  report: DeviceReport | undefined;
  ingestState: ConnectionState;
  sentFrames: number;
  droppedFrames: number;
  error: CaptureError | undefined;
}

/** The reducer's settings, as the 레벨 panel holds them. */
export interface NoiseOptions {
  enabled: boolean;
  /** Without a measured room there is nothing to reduce against. */
  profile: NoiseProfile | null;
  sensitivityDb: number;
}

export interface StartOptions {
  deviceId: string;
  /** The device's advertised maximum; what we ask getUserMedia for. */
  requestedChannelCount: number;
  /** Splitter output index the engineer picked. */
  channelIndex: number;
  /** Trim applied to that channel, in dB; see capture/gain.ts. */
  inputGainDb: number;
  noise: NoiseOptions;
  port: number;
  ingestToken: string;
}

/**
 * enumerateDevices() returns blank labels until a getUserMedia permission has
 * been granted at least once, so the UI calls this again after the first start.
 */
export async function listInputDevices(): Promise<InputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

const ANALYSER_FFT_SIZE = 2048;

/**
 * Owns every live resource of one capture session: the microphone stream, the
 * AudioContext and its worklet, and the ingest socket. Everything acquired
 * here is released in `stop()` — on an explicit stop, on a device change, and
 * on any error partway through `start()` — because a half-started graph must
 * never be left holding a live microphone.
 *
 * `start()` crosses several `await` boundaries (getUserMedia, addModule,
 * resume), and `stop()` can land on any one of them. Rather than a boolean
 * "are we mid-start" flag — which cannot tell "stopped" apart from "a newer
 * start() began" — each `start()` call captures a monotonically increasing
 * `generation` token. `stop()` always tears down whatever is currently
 * assigned to `this.*` immediately, unconditionally, and bumps the counter;
 * `start()` checks after every await whether its token is still current
 * before touching shared state, and if not, cleans up only the one resource
 * it is holding that `stop()` could not have known about yet, then bails out.
 */
export class CaptureController {
  private readonly listeners = new Set<(snapshot: CaptureSnapshot) => void>();
  private snapshot: CaptureSnapshot = {
    running: false,
    report: undefined,
    ingestState: "idle",
    sentFrames: 0,
    droppedFrames: 0,
    error: undefined,
  };

  private context: AudioContext | undefined;
  private stream: MediaStream | undefined;
  private worklet: AudioWorkletNode | undefined;
  private gain: GainNode | undefined;
  private gainDb = 0;
  private analyser: AnalyserNode | undefined;
  private analyserBuffer = new Float32Array(ANALYSER_FFT_SIZE);
  private ingest: IngestSocket | undefined;
  private accumulator = new FrameAccumulator();
  private readonly reducer = new NoiseReducer();
  private noiseEnabled = false;
  private measurement:
    | { profiler: NoiseProfiler; resolve: (p: NoiseProfile) => void; reject: (e: Error) => void }
    | undefined;
  private onDeviceChange: (() => void) | undefined;
  private generation = 0;

  getSnapshot(): CaptureSnapshot {
    return this.snapshot;
  }

  subscribe(fn: (snapshot: CaptureSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(patch: Partial<CaptureSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const fn of this.listeners) {
      try {
        fn(this.snapshot);
      } catch (err) {
        console.error("capture snapshot listener threw", err);
      }
    }
  }

  /**
   * Re-trims a running capture without reopening the device. The value is
   * also remembered for the next start(), so a slider moved while capture is
   * stopped is not lost. A GainNode's `value` takes effect at the next
   * render quantum, so there is nothing to await.
   */
  setGainDb(db: number): void {
    this.gainDb = clampGainDb(db);
    if (this.gain) this.gain.gain.value = dbToLinear(this.gainDb);
    // The room was measured after the trim, so the profile follows it.
    this.reducer.setTrimDb(this.gainDb);
  }

  /**
   * Re-configures the noise reducer on a running capture — or for the next
   * one; nothing here needs the graph. Takes effect on the next block, with
   * the reducer's own 24 ms of latency and no restart. Enabling starts from
   * a clean buffer rather than replaying whatever was in it when it was
   * last on.
   */
  setNoise(opts: NoiseOptions): void {
    this.reducer.setProfile(opts.profile, this.gainDb);
    this.reducer.setSensitivityDb(opts.sensitivityDb);
    const enabled = opts.enabled && opts.profile !== null;
    if (enabled && !this.noiseEnabled) this.reducer.reset();
    this.noiseEnabled = enabled;
  }

  /** How much the reducer is currently taking out, in dB; 0 when it is off. */
  readReductionDb(): number {
    return this.noiseEnabled ? this.reducer.reductionDb : 0;
  }

  /**
   * Listens to the next `ms` of the trimmed feed — the room with the speaker
   * quiet — and resolves with its profile. Rejects when capture is not
   * running or stops before the time is up; a second measurement started
   * over a first cancels it.
   */
  measureNoise(ms: number): Promise<NoiseProfile> {
    return new Promise((resolve, reject) => {
      const context = this.context;
      if (!this.snapshot.running || !context) {
        reject(new Error("capture is not running"));
        return;
      }
      this.measurement?.reject(new Error("superseded"));
      const profiler = new NoiseProfiler(Math.round((ms / 1000) * context.sampleRate));
      this.measurement = { profiler, resolve, reject };
    });
  }

  /** Latest RMS/peak/clipping. Called from a requestAnimationFrame loop. */
  readLevel(): LevelReading {
    if (!this.analyser) return measureLevel(new Float32Array(0));
    this.analyser.getFloatTimeDomainData(this.analyserBuffer);
    return measureLevel(this.analyserBuffer);
  }

  async start(opts: StartOptions): Promise<void> {
    await this.stop();
    const generation = ++this.generation;
    this.gainDb = clampGainDb(opts.inputGainDb);
    this.reducer.setTrimDb(this.gainDb);
    this.noiseEnabled = false; // so setNoise() below starts it from a clean buffer
    this.setNoise(opts.noise);
    this.emit({ error: undefined });

    let stream: MediaStream;
    try {
      // Exactly the constraint object from the spec, plus the channel request.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: opts.deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: opts.requestedChannelCount,
        },
      });
    } catch (err) {
      // deviceId: { exact } fails rather than substituting the built-in mic,
      // which is the behaviour the spec relies on.
      if (generation === this.generation) {
        this.emit({ error: { code: "deviceOpenFailed", ...describeCaptureCause(err) } });
      }
      throw err;
    }

    if (generation !== this.generation) {
      // Superseded by a stop() (or a newer start()) while getUserMedia was
      // pending. Nothing under this generation has touched this.* yet, so
      // releasing the tracks we were just handed is the entire teardown.
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) {
      this.emit({ error: { code: "deviceOpenFailed", name: "", reason: "no audio track" } });
      await this.stop();
      throw new Error("no audio track");
    }

    // The AudioContext performs the resample to the server's required rate.
    const context = new AudioContext({ sampleRate: 16000 });
    this.context = context;

    try {
      await context.audioWorklet.addModule(workletUrl);
    } catch (err) {
      if (generation === this.generation) {
        this.emit({ error: { code: "workletFailed", ...describeCaptureCause(err) } });
        await this.stop();
      }
      throw err;
    }

    if (generation !== this.generation) {
      // A stop() landed during addModule(). this.stream and this.context were
      // already assigned above, so the ordinary teardown already released them.
      return;
    }

    try {
      const settings = track.getSettings();
      const report = buildDeviceReport({
        requestedChannelCount: opts.requestedChannelCount,
        selectedChannelIndex: opts.channelIndex,
        contextSampleRate: context.sampleRate,
        settings,
      });
      this.emit({ report });

      const achieved = report.achievedChannelCount;
      const channelIndex = clampChannelIndex(opts.channelIndex, achieved);

      const source = context.createMediaStreamSource(stream);
      // Pin the source so nothing downmixes on the way into the splitter.
      source.channelCount = achieved;
      source.channelCountMode = "explicit";
      source.channelInterpretation = "discrete";

      // ChannelSplitterNode is discrete by definition: its channelCountMode is
      // "explicit" and its channelInterpretation is "discrete", so a connection
      // into it is spread across outputs rather than mixed.
      const splitter = context.createChannelSplitter(achieved);
      source.connect(splitter);

      // The engineer's trim sits right after channel selection, so both the
      // meter and the ingest socket below see the same, trimmed signal: a
      // boost that clips shows red here before it reaches the model.
      const gain = context.createGain();
      gain.channelCount = 1;
      gain.channelCountMode = "explicit";
      gain.channelInterpretation = "discrete";
      gain.gain.value = dbToLinear(this.gainDb);
      this.gain = gain;
      splitter.connect(gain, channelIndex, 0);

      const worklet = new AudioWorkletNode(context, "pcm-tap", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "discrete",
      });
      this.worklet = worklet;
      gain.connect(worklet);

      const analyser = context.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      this.analyser = analyser;
      this.analyserBuffer = new Float32Array(analyser.fftSize);
      gain.connect(analyser);

      // Chromium only renders a worklet that reaches the destination. gain = 0
      // keeps the graph running without sending anything to the speakers, which
      // would otherwise feed back into the venue PA.
      const silence = context.createGain();
      silence.gain.value = 0;
      worklet.connect(silence);
      silence.connect(context.destination);

      const ingest = new IngestSocket({
        url: ingestUrl({ port: opts.port, token: opts.ingestToken }),
        // The browser's global WebSocket satisfies SocketLike structurally; the
        // cast is only needed because its addEventListener overloads are narrower.
        factory: (url) => new WebSocket(url) as unknown as SocketLike,
      });
      this.ingest = ingest;
      ingest.onState((state) => this.emit({ ingestState: state }));
      ingest.start();

      this.accumulator = new FrameAccumulator();
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        let samples = event.data;
        // The profiler hears what the reducer will: the trimmed feed.
        const measurement = this.measurement;
        if (measurement) {
          measurement.profiler.push(samples);
          if (measurement.profiler.done) {
            this.measurement = undefined;
            measurement.resolve(measurement.profiler.profile(this.gainDb));
          }
        }
        if (this.noiseEnabled) samples = this.reducer.process(samples);
        for (const frame of this.accumulator.push(floatTo16BitPcm(samples))) {
          ingest.sendFrame(frame);
        }
        this.emit({ sentFrames: ingest.sentFrames, droppedFrames: ingest.droppedFrames });
      };

      // The spec's failure row: the interface is unplugged, the track ends,
      // capture stops and the engineer is told in Korean.
      track.addEventListener("ended", () => {
        void this.stop();
        this.emit({ error: { code: "deviceLost" } });
      });

      this.onDeviceChange = () => {
        if (track.readyState === "ended") {
          void this.stop();
          this.emit({ error: { code: "deviceLost" } });
        }
      };
      navigator.mediaDevices.addEventListener("devicechange", this.onDeviceChange);

      await context.resume();
    } catch (err) {
      // Anything from graph wiring through resume() leaves a half-built
      // graph; it must not be left holding the microphone or the socket.
      if (generation === this.generation) {
        this.emit({ error: { code: "workletFailed", ...describeCaptureCause(err) } });
        await this.stop();
      }
      throw err;
    }

    if (generation !== this.generation) {
      // A stop() landed during resume(); everything above is already
      // assigned to this.*, so the ordinary teardown already released it.
      return;
    }

    this.emit({ running: true });
  }

  async stop(): Promise<void> {
    this.generation++;

    if (this.measurement) {
      this.measurement.reject(new Error("capture stopped"));
      this.measurement = undefined;
    }

    if (this.onDeviceChange) {
      navigator.mediaDevices.removeEventListener("devicechange", this.onDeviceChange);
      this.onDeviceChange = undefined;
    }

    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet = undefined;
    }

    this.analyser?.disconnect();
    this.analyser = undefined;

    this.gain?.disconnect();
    this.gain = undefined;

    this.ingest?.stop();
    this.ingest = undefined;

    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = undefined;

    if (this.context) {
      // Cleared before the await, not after: two stop() calls issued back to
      // back (no await between them) would otherwise both see this.context
      // set and both call close() on it, and closing an already-closing
      // AudioContext rejects per spec.
      const context = this.context;
      this.context = undefined;
      await context.close();
    }

    this.accumulator.reset();
    this.emit({ running: false, ingestState: "stopped" });
  }
}
