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
