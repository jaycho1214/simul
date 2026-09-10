import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.ts";

const base = { GEMINI_API_KEY: "k", INGEST_TOKEN: "t" };

test("applies spec defaults", () => {
  const c = loadConfig(base);
  assert.equal(c.port, 8080);
  assert.equal(c.sourceLanguage, "ko");
  assert.deepEqual(c.offeredLanguages, ["ko", "en", "es", "ja"]);
  assert.equal(c.maxConcurrentLanes, 6);
  assert.equal(c.laneGraceMs, 60000);
  assert.equal(c.transcriptHistoryLines, 200);
  assert.equal(c.transcriptDelayMs, 0);
  assert.equal(c.opusBitrate, 24000);
});

test("parses OFFERED_LANGUAGES as JSON", () => {
  const c = loadConfig({ ...base, OFFERED_LANGUAGES: '["ko","fr"]' });
  assert.deepEqual(c.offeredLanguages, ["ko", "fr"]);
});

test("rejects a missing API key", () => {
  assert.throws(() => loadConfig({ INGEST_TOKEN: "t" }), /GEMINI_API_KEY/);
});

test("rejects a source language missing from the offered list", () => {
  assert.throws(
    () => loadConfig({ ...base, OFFERED_LANGUAGES: '["en"]' }),
    /SOURCE_LANGUAGE/,
  );
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
  });
  assert.equal(c.port, 8080);
  assert.equal(c.opusBitrate, 24000);
  assert.equal(c.maxConcurrentLanes, 6);
  assert.equal(c.laneGraceMs, 60000);
  assert.equal(c.transcriptHistoryLines, 200);
  assert.equal(c.transcriptDelayMs, 0);
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
  assert.throws(() => loadConfig({ ...base, TRANSCRIPT_HISTORY_LINES: "0" }), /TRANSCRIPT_HISTORY_LINES/);
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
