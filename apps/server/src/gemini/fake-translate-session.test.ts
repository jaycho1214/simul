import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeTranslateSessionFactory } from "./fake-translate-session.ts";

// Non-silent PCM: the fake never inspects frame content, so this changes no
// assertion below, but it avoids exercising every downstream test exclusively
// against all-zero buffers (see task-7 brief judgement call).
const frame = () => {
  const buf = Buffer.alloc(640);
  for (let i = 0; i < buf.length; i++) buf[i] = i % 256;
  return buf;
};

test("reports live once opened", async () => {
  const session = await createFakeTranslateSessionFactory()({ targetLanguage: "en" });
  const states: string[] = [];
  session.on("state", (s) => states.push(s));
  session.sendPcm16k(frame());
  assert.deepEqual(states, ["live"]);
});

test("emits 24 kHz audio every 25 frames", async () => {
  const session = await createFakeTranslateSessionFactory()({ targetLanguage: "en" });
  const chunks: Buffer[] = [];
  session.on("audio", (pcm) => chunks.push(pcm));

  for (let i = 0; i < 24; i++) session.sendPcm16k(frame());
  assert.equal(chunks.length, 0);

  session.sendPcm16k(frame());
  assert.equal(chunks.length, 1);
  // 25 frames = 500 ms; at 24 kHz mono s16le that is 24000 bytes.
  assert.equal(chunks[0]!.length, 24000);
});

test("emits a deterministic transcript alongside the audio", async () => {
  const session = await createFakeTranslateSessionFactory()({ targetLanguage: "es" });
  const lines: Array<{ text: string; isFinal: boolean }> = [];
  session.on("transcript", (text, isFinal) => lines.push({ text, isFinal }));

  for (let i = 0; i < 50; i++) session.sendPcm16k(frame());
  assert.deepEqual(lines, [
    { text: "es utterance 1", isFinal: true },
    { text: "es utterance 2", isFinal: true },
  ]);
});

test("close emits closed and stops output", async () => {
  const session = await createFakeTranslateSessionFactory()({ targetLanguage: "en" });
  let closedReason = "";
  const chunks: Buffer[] = [];
  session.on("closed", (r) => { closedReason = r; });
  session.on("audio", (c) => chunks.push(c));

  session.close();
  for (let i = 0; i < 25; i++) session.sendPcm16k(frame());

  assert.equal(closedReason, "closed by caller");
  assert.equal(chunks.length, 0);
  assert.equal(session.canAccept(), false);
});

test("close is safe to call twice", async () => {
  const session = await createFakeTranslateSessionFactory()({ targetLanguage: "en" });
  let closedCount = 0;
  let closedReason = "";
  session.on("closed", (r) => { closedCount++; closedReason = r; });

  session.close();
  session.close();

  assert.equal(closedCount, 1);
  assert.equal(closedReason, "closed by caller");
});
