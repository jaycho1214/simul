import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.ts";

const base = { GEMINI_API_KEY: "k", INGEST_TOKEN: "t" };

test("applies spec defaults", () => {
  const c = loadConfig(base);
  assert.equal(c.port, 8080);
  assert.equal(c.passthroughLane, false);
  assert.deepEqual(c.offeredLanguages, ["ko", "en", "es", "ja"]);
  assert.equal(c.maxConcurrentLanes, 6);
  assert.equal(c.laneGraceMs, 60000);
  assert.equal(c.transcriptHistoryLines, 200);
  assert.equal(c.transcriptDelayMs, 0);
  assert.equal(c.opusBitrate, 128000);
});

test("parses OFFERED_LANGUAGES as JSON", () => {
  const c = loadConfig({ ...base, OFFERED_LANGUAGES: '["ko","fr"]' });
  assert.deepEqual(c.offeredLanguages, ["ko", "fr"]);
});

test("rejects a missing API key", () => {
  assert.throws(() => loadConfig({ INGEST_TOKEN: "t" }), /GEMINI_API_KEY/);
});

// There is no source language any more: every offered language is a
// translation, and the model detects what is spoken. The only untranslated
// lane is the optional debug passthrough, off unless asked for in so many words.
test("PASSTHROUGH_LANE is off by default and reads the usual yes/no spellings", () => {
  assert.equal(loadConfig(base).passthroughLane, false);
  for (const on of ["true", "1", "yes", "on", " TRUE "]) {
    assert.equal(loadConfig({ ...base, PASSTHROUGH_LANE: on }).passthroughLane, true, on);
  }
  for (const off of ["false", "0", "no", "off", ""]) {
    assert.equal(loadConfig({ ...base, PASSTHROUGH_LANE: off }).passthroughLane, false, off);
  }
});

test("a PASSTHROUGH_LANE that is neither yes nor no stops startup", () => {
  assert.throws(() => loadConfig({ ...base, PASSTHROUGH_LANE: "maybe" }), /PASSTHROUGH_LANE/);
});

// `num()` used to map any defined value through `Number(raw)`, and
// `Number("")` is 0. A .env line left as `OPUS_BITRATE=` — a value commented
// out by deletion rather than by `#` — therefore became a bitrate of 0, which
// libopus rejects with "Encoder CTL error: Bad argument" *inside a lane
// constructor*, after a live Gemini session had already been opened. Config
// is where that has to be caught: at startup, loudly, before an event.
test("an env var that is set but empty falls back to the default", () => {
  const c = loadConfig({
    ...base,
    PORT: "",
    OPUS_BITRATE: "",
    MAX_CONCURRENT_LANES: "   ",
    LANE_GRACE_MS: "",
    TRANSCRIPT_HISTORY_LINES: "",
    TRANSCRIPT_DELAY_MS: "",
    STREAM_PRIME_MS: "",
  });
  assert.equal(c.port, 8080);
  assert.equal(c.opusBitrate, 128000);
  assert.equal(c.maxConcurrentLanes, 6);
  assert.equal(c.laneGraceMs, 60000);
  assert.equal(c.transcriptHistoryLines, 200);
  assert.equal(c.transcriptDelayMs, 0);
  assert.equal(c.streamPrimeMs, 3072);
});

test("rejects an out-of-range OPUS_BITRATE rather than letting a lane throw mid-event", () => {
  assert.throws(() => loadConfig({ ...base, OPUS_BITRATE: "0" }), /OPUS_BITRATE/);
  assert.throws(() => loadConfig({ ...base, OPUS_BITRATE: "-1" }), /OPUS_BITRATE/);
  assert.throws(() => loadConfig({ ...base, OPUS_BITRATE: "999999" }), /OPUS_BITRATE/);
});

test("rejects a lane cap that could never open a lane", () => {
  assert.throws(() => loadConfig({ ...base, MAX_CONCURRENT_LANES: "0" }), /MAX_CONCURRENT_LANES/);
  assert.throws(() => loadConfig({ ...base, MAX_CONCURRENT_LANES: "-3" }), /MAX_CONCURRENT_LANES/);
});

test("rejects a transcript history that would keep nothing", () => {
  assert.throws(
    () => loadConfig({ ...base, TRANSCRIPT_HISTORY_LINES: "0" }),
    /TRANSCRIPT_HISTORY_LINES/,
  );
});

test("rejects negative durations and out-of-range ports", () => {
  assert.throws(() => loadConfig({ ...base, LANE_GRACE_MS: "-1" }), /LANE_GRACE_MS/);
  assert.throws(() => loadConfig({ ...base, TRANSCRIPT_DELAY_MS: "-1" }), /TRANSCRIPT_DELAY_MS/);
  assert.throws(() => loadConfig({ ...base, PORT: "70000" }), /PORT/);
});

test("rejects a fractional value where only whole units make sense", () => {
  assert.throws(() => loadConfig({ ...base, MAX_CONCURRENT_LANES: "2.5" }), /MAX_CONCURRENT_LANES/);
});

test("still rejects a value that is not a number at all", () => {
  assert.throws(() => loadConfig({ ...base, PORT: "eight thousand" }), /PORT must be a number/);
});

test("defaults webRoot to the built web app and honours WEB_ROOT", () => {
  assert.ok(loadConfig(base).webRoot.endsWith("/web/dist"));
  assert.equal(loadConfig({ ...base, WEB_ROOT: "" }).webRoot, "");
  assert.equal(loadConfig({ ...base, WEB_ROOT: "/srv/web" }).webRoot, "/srv/web");
});

// "auto" rather than "dark": an unset theme follows each phone's own
// light/dark setting, so a daytime event is not dark on every screen unless the
// operator chose that.
test("leaves the brand unset by default", () => {
  const c = loadConfig(base);
  assert.deepEqual(c.brand, {
    name: "",
    accent: "#3e8fd0",
    logoPath: "",
    theme: "auto",
  });
});

test("reads a fully specified brand", () => {
  const c = loadConfig({
    ...base,
    BRAND_NAME: "  주일 예배  ",
    BRAND_ACCENT: "#7A3E9D",
    BRAND_LOGO: "/srv/event/logo.svg",
    BRAND_THEME: "auto",
  });
  assert.deepEqual(c.brand, {
    name: "주일 예배",
    accent: "#7a3e9d",
    logoPath: "/srv/event/logo.svg",
    theme: "auto",
  });
});

test("expands a three-digit accent to six", () => {
  assert.equal(loadConfig({ ...base, BRAND_ACCENT: "#f80" }).brand.accent, "#ff8800");
});

test("accepts an accent with no leading hash", () => {
  assert.equal(loadConfig({ ...base, BRAND_ACCENT: "7a3e9d" }).brand.accent, "#7a3e9d");
});

// Every one of these fails at boot rather than at the moment an attendee first
// loads the page, which is the only time an operator can still do anything
// about it.
test("rejects an unparseable accent", () => {
  assert.throws(() => loadConfig({ ...base, BRAND_ACCENT: "puce" }), /BRAND_ACCENT/);
});

test("rejects an unknown theme", () => {
  assert.throws(() => loadConfig({ ...base, BRAND_THEME: "sepia" }), /BRAND_THEME/);
});

test("rejects a logo whose type cannot be served", () => {
  assert.throws(() => loadConfig({ ...base, BRAND_LOGO: "/srv/event/logo.tiff" }), /BRAND_LOGO/);
});

test("treats blank brand vars as unset", () => {
  const c = loadConfig({
    ...base,
    BRAND_NAME: "   ",
    BRAND_ACCENT: "",
    BRAND_LOGO: "",
    BRAND_THEME: "",
  });
  assert.deepEqual(c.brand, {
    name: "",
    accent: "#3e8fd0",
    logoPath: "",
    theme: "auto",
  });
});

// 0 is a legitimate value here, not a mistake to reject: it turns priming off
// and restores the pre-2026-09-11 behaviour of starting a joining listener
// from now. Only a negative or absurd value is an error.
test("STREAM_PRIME_MS accepts 0 as a real opt-out but rejects nonsense", () => {
  assert.equal(loadConfig({ ...base, STREAM_PRIME_MS: "0" }).streamPrimeMs, 0);
  assert.throws(() => loadConfig({ ...base, STREAM_PRIME_MS: "-1" }), /STREAM_PRIME_MS/);
  assert.throws(() => loadConfig({ ...base, STREAM_PRIME_MS: "600000" }), /STREAM_PRIME_MS/);
});

// Chrome's <audio> exposes data to the demuxer only in whole 32 KiB blocks
// ("Our blocks are 32kb (1 << 15)", multi_buffer.h), so the prime is only
// useful if it actually fills one. That makes it a function of OPUS_BITRATE,
// not a constant: at 24 kbps a 4 s prime is ~12 KB and fills nothing.
test("STREAM_PRIME_MS defaults to enough audio to fill Chrome's 32 KiB block", () => {
  const BLOCK = 32768;
  for (const bitrate of ["24000", "64000", "128000", "256000"]) {
    const c = loadConfig({ ...base, OPUS_BITRATE: bitrate });
    const bytes = (c.streamPrimeMs / 1000) * (Number(bitrate) / 8);
    assert.ok(
      bytes > BLOCK,
      `at ${bitrate}bps the default prime is ${Math.round(bytes)}B, under one ${BLOCK}B block`,
    );
  }
});

test("a lower bitrate needs a longer prime, and the default follows it", () => {
  const slow = loadConfig({ ...base, OPUS_BITRATE: "24000" }).streamPrimeMs;
  const fast = loadConfig({ ...base, OPUS_BITRATE: "128000" }).streamPrimeMs;
  assert.ok(slow > fast, `24kbps prime ${slow}ms should exceed 128kbps prime ${fast}ms`);
});
