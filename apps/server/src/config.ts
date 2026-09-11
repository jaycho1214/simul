import { fileURLToPath } from "node:url";
import type { LangCode } from "@simul/protocol";

export type BrandTheme = "dark" | "light" | "auto";

export interface Brand {
  /** The event's name. Empty when the operator left it unset. */
  readonly name: string;
  /** Normalised to lowercase `#rrggbb`. */
  readonly accent: string;
  /** Absolute path to the logo file on this machine. Empty when unset. */
  readonly logoPath: string;
  readonly theme: BrandTheme;
}

export interface Config {
  readonly geminiApiKey: string;
  readonly ingestToken: string;
  readonly port: number;
  /**
   * Offer the room's own audio, untranslated, on the `original` lane. A
   * debugging aid for checking the capture chain end to end; off for an event,
   * where every lane goes through the model (see LaneManager.PASSTHROUGH_LANG).
   */
  readonly passthroughLane: boolean;
  readonly offeredLanguages: readonly LangCode[];
  readonly maxConcurrentLanes: number;
  readonly laneGraceMs: number;
  readonly transcriptHistoryLines: number;
  readonly transcriptDelayMs: number;
  readonly opusBitrate: number;
  readonly streamPrimeMs: number;
  /** Directory of the built attendee app. Empty disables static serving. */
  readonly webRoot: string;
  readonly brand: Brand;
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}

/**
 * Whole-number env var with a valid range.
 *
 * The empty-string case is the one that matters. `Number("")` is 0, so a
 * .env line left as `OPUS_BITRATE=` — a value commented out by deleting it
 * rather than by prefixing `#`, or a template variable that never got
 * substituted — used to become a bitrate of 0. libopus rejects that with
 * "Encoder CTL error: Bad argument", thrown from inside a lane constructor
 * *after* a live Gemini session had already been opened for that lane. An
 * unset var and a var set to nothing are the same operator intent — "I did
 * not choose a value" — so both take the default.
 *
 * The range check exists for the same reason: every one of these values ends
 * up as an argument to something that has opinions about it, and a
 * bad one must fail here, once, at startup, rather than at the moment an
 * attendee first taps a language during a talk.
 */
function num(env: Env, key: string, fallback: number, range: { min: number; max: number }): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got ${raw}`);
  if (!Number.isInteger(n)) throw new Error(`${key} must be a whole number, got ${raw}`);
  if (n < range.min || n > range.max) {
    throw new Error(`${key} must be between ${range.min} and ${range.max}, got ${raw}`);
  }
  return n;
}

/**
 * A yes/no env var. Unset and empty both mean the default, like `num()`; any
 * other spelling than the six below is a typo that must stop startup rather
 * than silently read as "off".
 */
function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  throw new Error(`${key} must be true or false, got ${env[key]}`);
}

/**
 * libopus accepts far wider than this, but outside it the encoder is either
 * producing unintelligible speech or wasting an event's bandwidth on a codec
 * that cannot use it. Both ends are well inside what `OPUS_SET_BITRATE`
 * itself tolerates, so anything that passes here is guaranteed to construct.
 */
const MIN_OPUS_BITRATE = 6_000;

/**
 * 128 kbps, which is lavish for mono speech and chosen for timing, not
 * quality. Chrome gates playback on filling a 32 KiB buffer block, so the wire
 * byte rate sets the listener's latency floor: 24 kbps made that block take
 * 9.4 s, while 128 kbps CBR fills it in ~2.0 s. Under 3 s also keeps Chrome's
 * `stalled` timer quiet, which otherwise fires between blocks and makes the
 * attendee app tear the stream down and rejoin.
 *
 * The cost is bandwidth: ~16 KB/s per listening phone, so 60 phones is roughly
 * 8 Mbps of venue wifi where 24 kbps needed 1.5 Mbps. Lower it if the AP
 * cannot take that, but expect the delay to rise roughly in proportion.
 */
const DEFAULT_OPUS_BITRATE = 128_000;
const MAX_OPUS_BITRATE = 510_000;

/**
 * Chrome's `<audio>` exposes network data to the demuxer only in whole 32 KiB
 * blocks — "Our blocks are 32kb (1 << 15)", `multi_buffer.h`, indexed as
 * `block_num = byte_pos >> 15` from byte 0 of the response. Nothing plays at
 * all until the first block is full.
 */
const CHROME_MULTIBUFFER_BLOCK_BYTES = 32_768;

/**
 * Blocks of prime: one to fill block 1 so playback starts at once, and one
 * more as *runway*.
 *
 * Runway is the gap between the playhead and the newest decodable audio. The
 * playhead trails live by the prime; the exposed edge trails live by anywhere
 * from 0 to a full block depending on where in the block cycle the listener
 * joined. With only one block of prime that gap reaches zero at the worst
 * phase, and an underrun is not self-correcting here: Chrome's renderer
 * doubles its buffering threshold on every underrun and only resets when the
 * element reloads, so a stream that starves once "recovers" by permanently
 * sitting further behind.
 *
 * 1.5 blocks is the working compromise: half a block of runway at every phase
 * of the sawtooth. The hard floor is 1.0 (below that block 1 does not fill and
 * playback waits for live bytes anyway); 1.25 is a knife edge that underruns
 * at the worst phase. Drop toward 1.25 only once the stream is known not to
 * starve.
 */
const PRIME_BLOCKS = 1.5;

/**
 * How much recent audio a joining listener is handed before live clusters, so
 * that first block is full on arrival instead of being waited out in real time.
 *
 * Derived from the bitrate rather than fixed, because the two are inseparable:
 * a block is a fixed number of BYTES, so how many milliseconds fill it depends
 * entirely on `OPUS_BITRATE`. A constant here is a trap — 4 s fills a block at
 * 128 kbps but is only 12 KB at 24 kbps, which fills nothing, and the delay
 * silently returns the moment someone lowers the bitrate for bandwidth.
 *
 * Kept as small as that allows, because the prime is not free: a plain
 * `<audio>` starts at the OLDEST cluster it receives and never skips forward,
 * so this duration is added to every listener's latency for as long as they
 * listen. One block plus headroom is the floor; more is pure delay.
 */
function defaultStreamPrimeMs(opusBitrate: number): number {
  const bytesPerSecond = opusBitrate / 8;
  return Math.ceil((CHROME_MULTIBUFFER_BLOCK_BYTES / bytesPerSecond) * PRIME_BLOCKS * 1000);
}

/** An hour. Past this a "grace" period is really a lane that never closes. */
const MAX_LANE_GRACE_MS = 3_600_000;

/**
 * Unbranded default: a steel blue that reads as equipment rather than as
 * anyone's brand, and that collides with none of the tally colours (green
 * live, amber working, red fault) it has to sit beside. Mirrored in
 * apps/web's `src/brand.ts` as DEFAULT_ACCENT, so the page looks the same
 * before and after /config has been read.
 */
const DEFAULT_ACCENT = "#3e8fd0";

const BRAND_THEMES: readonly BrandTheme[] = ["dark", "light", "auto"];

/**
 * What `BrandRoute` can put a content-type on. Checked here so an operator who
 * points at a .tiff finds out at startup rather than discovering a broken
 * image on sixty phones.
 */
const LOGO_EXTENSIONS = [".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif"];

/**
 * Accepts the forms an operator actually types — with or without the hash,
 * three digits or six, any case — and normalises them to one. Rejecting is
 * the important half: an unusable colour must stop the process here, at
 * startup, while somebody is still watching the terminal.
 */
function accent(env: Env, key: string): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return DEFAULT_ACCENT;

  const body = raw.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(body)) {
    const [r, g, b] = body.toLowerCase().split("") as [string, string, string];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-f]{6}$/i.test(body)) return `#${body.toLowerCase()}`;

  throw new Error(`${key} must be a hex colour like #3e8fd0, got ${raw}`);
}

function brand(env: Env): Brand {
  const theme = env.BRAND_THEME?.trim() ?? "";
  if (theme !== "" && !BRAND_THEMES.includes(theme as BrandTheme)) {
    throw new Error(`BRAND_THEME must be one of ${BRAND_THEMES.join(", ")}, got ${theme}`);
  }

  const logoPath = env.BRAND_LOGO?.trim() ?? "";
  if (logoPath !== "") {
    const ext = logoPath.slice(logoPath.lastIndexOf(".")).toLowerCase();
    if (!LOGO_EXTENSIONS.includes(ext)) {
      throw new Error(`BRAND_LOGO must be one of ${LOGO_EXTENSIONS.join(", ")}, got ${logoPath}`);
    }
  }

  return Object.freeze({
    name: env.BRAND_NAME?.trim() ?? "",
    accent: accent(env, "BRAND_ACCENT"),
    logoPath,
    // Unset follows each phone's own light/dark setting. Forcing dark was
    // the earlier default, and it made a daytime event dark on every screen
    // unless the operator knew to change it; "auto" is what a phone would do
    // anyway, and the operator can still pin either scheme for the room.
    theme: (theme === "" ? "auto" : theme) as BrandTheme,
  });
}

export function loadConfig(env: Env = process.env): Config {
  const offeredLanguages: LangCode[] = env.OFFERED_LANGUAGES
    ? JSON.parse(env.OFFERED_LANGUAGES)
    : ["ko", "en", "es", "ja"];
  const opusBitrate = num(env, "OPUS_BITRATE", DEFAULT_OPUS_BITRATE, {
    min: MIN_OPUS_BITRATE,
    max: MAX_OPUS_BITRATE,
  });

  return Object.freeze({
    geminiApiKey: required(env, "GEMINI_API_KEY"),
    ingestToken: required(env, "INGEST_TOKEN"),
    // 0 is legitimate, not a mistake to reject: it asks the OS for an
    // ephemeral port. `createServer().listen()` returns the port actually
    // bound and index.ts logs it, so the value stays discoverable.
    port: num(env, "PORT", 8080, { min: 0, max: 65535 }),
    offeredLanguages: Object.freeze(offeredLanguages),
    passthroughLane: bool(env, "PASSTHROUGH_LANE", false),
    maxConcurrentLanes: num(env, "MAX_CONCURRENT_LANES", 6, { min: 1, max: 64 }),
    laneGraceMs: num(env, "LANE_GRACE_MS", 60000, { min: 0, max: MAX_LANE_GRACE_MS }),
    transcriptHistoryLines: num(env, "TRANSCRIPT_HISTORY_LINES", 200, { min: 1, max: 10_000 }),
    transcriptDelayMs: num(env, "TRANSCRIPT_DELAY_MS", 0, { min: 0, max: 60_000 }),
    opusBitrate,
    streamPrimeMs: num(env, "STREAM_PRIME_MS", defaultStreamPrimeMs(opusBitrate), {
      min: 0,
      max: 60_000,
    }),
    // Empty is a deliberate opt-out (dev running Vite standalone in front of
    // this server), not "not configured" — unlike num()'s treatment of an
    // env var set to nothing, so `??` rather than `||` here.
    webRoot: env.WEB_ROOT ?? fileURLToPath(new URL("../../web/dist", import.meta.url)),
    brand: brand(env),
  });
}
