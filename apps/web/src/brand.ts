export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Every accent this module sees was typed by an operator into a .env file, so
 * the tolerant forms people actually write are all accepted and anything else
 * returns null for the caller to fall back on. Nothing here throws: a typo in
 * a colour must never be the reason an attendee's screen fails to render.
 */
export function parseHex(input: string): Rgb | null {
  const raw = input.trim().replace(/^#/, "");

  if (/^[0-9a-f]{3}$/i.test(raw)) {
    const [r, g, b] = raw.split("") as [string, string, string];
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
    };
  }

  if (/^[0-9a-f]{6}$/i.test(raw)) {
    const n = parseInt(raw, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }

  return null;
}

export const BLACK: Rgb = { r: 0, g: 0, b: 0 };
export const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** sRGB 0-255 to linear-light 0-1. */
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance. */
export function luminance(c: Rgb): number {
  return (
    0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b)
  );
}

/** WCAG 2.x contrast ratio, 1:1 to 21:1. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface Oklch {
  /** Perceptual lightness, 0 (black) to 1 (white). */
  l: number;
  /** Chroma. Unbounded in theory, roughly 0-0.37 inside sRGB. */
  c: number;
  /** Hue angle in degrees, [0, 360). */
  h: number;
}

/** From linear-light 0-1 back to an sRGB 0-255 channel. */
function fromLinear(channel: number): number {
  const c =
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

/**
 * Ottosson's Oklab. Used rather than HSL because the whole point of this
 * module is to change a colour's lightness without changing the colour: HSL
 * lightness is not perceptual, so an HSL-lightened yellow and an HSL-lightened
 * blue land nowhere near each other visually.
 */
export function toOklch(rgb: Rgb): Oklch {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  const lp = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mp = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sp = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const l = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp;
  const a = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp;
  const bb = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp;

  return {
    l,
    c: Math.sqrt(a * a + bb * bb),
    h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
  };
}

export function fromOklch(colour: Oklch): Rgb {
  const rad = (colour.h * Math.PI) / 180;
  const a = colour.c * Math.cos(rad);
  const b = colour.c * Math.sin(rad);

  const lp = (colour.l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (colour.l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (colour.l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: fromLinear(4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp),
    g: fromLinear(-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp),
    b: fromLinear(-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp),
  };
}

export function toHex(rgb: Rgb): string {
  const pair = (n: number) => n.toString(16).padStart(2, "0");
  return `#${pair(rgb.r)}${pair(rgb.g)}${pair(rgb.b)}`;
}

/** True when the colour survives the trip to sRGB without a channel clipping. */
function inGamut(colour: Oklch): boolean {
  const rgb = fromOklch(colour);
  const back = toOklch(rgb);
  return Math.abs(back.l - colour.l) < 0.02 && Math.abs(back.c - colour.c) < 0.02;
}

/**
 * Raising lightness at a fixed chroma often leaves sRGB entirely — there is no
 * light, fully saturated blue. Chroma is what gives way, because the hue is
 * the operator's actual choice and the lightness is what keeps the colour
 * legible; saturation is the only one of the three nobody will miss.
 */
function intoGamut(colour: Oklch): Oklch {
  if (inGamut(colour)) return colour;

  let lo = 0;
  let hi = colour.c;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (inGamut({ ...colour, c: mid })) lo = mid;
    else hi = mid;
  }
  return { ...colour, c: lo };
}

/**
 * The two page grounds, mirrored from `styles.css`. A test reads the
 * stylesheet and asserts these still match, because a drifting copy here would
 * silently void every contrast guarantee below.
 */
export const GROUND = {
  dark: "#05070a",
  light: "#f7f8fa",
} as const;

/**
 * Unbranded default: a steel blue that reads as equipment rather than as
 * anyone's brand, and that collides with none of the tally colours (green
 * live, amber working, red fault) it has to sit beside.
 */
export const DEFAULT_ACCENT = "#3e8fd0";

/**
 * WCAG minimum for a UI component boundary — a rule, a focus ring, a filled
 * marker. What `--accent` is used as.
 */
const MIN_SHAPE_CONTRAST = 3.05;
/** WCAG minimum for body text. What `--accent-text` is used as. */
const MIN_TEXT_CONTRAST = 4.55;

/**
 * Walks the accent's lightness away from the page ground until it clears the
 * given contrast, and returns the first value that does.
 *
 * Lightness is what moves because hue is the operator's actual choice, and
 * chroma is given up only where the result would leave sRGB (see `intoGamut`).
 * Bounded by the step count rather than by reaching the threshold: an accent
 * that has already run to white or black cannot improve further, and the loop
 * has to end regardless.
 */
function pushFromGround(
  accent: Rgb,
  scheme: "dark" | "light",
  minContrast: number,
): Rgb {
  const ground = parseHex(GROUND[scheme])!;
  const step = scheme === "dark" ? 0.01 : -0.01;
  const start = toOklch(accent);

  let candidate = accent;
  for (let i = 0; i <= 100; i += 1) {
    const l = Math.min(1, Math.max(0, start.l + step * i));
    candidate = fromOklch(intoGamut({ ...start, l }));
    if (contrastRatio(candidate, ground) >= minContrast) return candidate;
  }
  return candidate;
}

/** Named rather than a bare record so callers cannot ask for a token that
 *  the stylesheet has no default for. */
export interface AccentTokens {
  /** Shapes: the source-language rule, the focus ring, the muted border. */
  "--accent": string;
  /** Words set in the accent colour, directly on the page ground. */
  "--accent-text": string;
  /** A translucent fill behind those words. */
  "--accent-wash": string;
}

/**
 * Every CSS custom property that depends on the operator's accent, ready to be
 * written onto the document root. The stylesheet ships a default for each so
 * the page is fully styled before this ever runs.
 */
export function accentTokens(
  accent: string,
  scheme: "dark" | "light",
): AccentTokens {
  const parsed = parseHex(accent) ?? parseHex(DEFAULT_ACCENT)!;
  const shape = pushFromGround(parsed, scheme, MIN_SHAPE_CONTRAST);

  return {
    "--accent": toHex(shape),
    "--accent-text": toHex(pushFromGround(parsed, scheme, MIN_TEXT_CONTRAST)),
    "--accent-wash": `rgba(${shape.r}, ${shape.g}, ${shape.b}, 0.16)`,
  };
}
