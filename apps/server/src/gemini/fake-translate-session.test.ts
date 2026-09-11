import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFakeTranslateSessionFactory,
  FakeTranslateSession,
} from "./fake-translate-session.ts";

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
  session.on("closed", (r) => {
    closedReason = r;
  });
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
  session.on("closed", (r) => {
    closedCount++;
    closedReason = r;
  });

  session.close();
  session.close();

  assert.equal(closedCount, 1);
  assert.equal(closedReason, "closed by caller");
});

// The contract in translate-session.ts: a closed session is inert. The fake
// must hold to it as strictly as the real session does, or every downstream
// test (SessionRotator's above all) would be verifying no-duplicate behaviour
// against an invariant only the fake enforces.
for (const end of ["close()", "simulateDeath()"] as const) {
  test(`a session ended by ${end} emits nothing further on any path`, async () => {
    const session = new FakeTranslateSession("en");
    const events: string[] = [];
    session.on("audio", (pcm) => events.push(`audio:${pcm.length}`));
    session.on("transcript", (text, isFinal) => events.push(`transcript:${text}:${isFinal}`));
    session.on("state", (s) => events.push(`state:${s}`));
    session.on("closed", (reason) => events.push(`closed:${reason}`));

    // Mid-utterance when the session ends, so a leaked frame counter would
    // show up as a completed utterance below.
    for (let i = 0; i < 20; i++) session.sendPcm16k(frame());
    assert.deepEqual(events, ["state:live"], "still live up to this point");
    events.length = 0;

    if (end === "close()") session.close();
    else session.simulateDeath("connection reset");
    assert.equal(events.length, 1, "exactly one closed event");
    events.length = 0;

    for (let i = 0; i < 50; i++) session.sendPcm16k(frame());
    session.simulateGoAway();
    session.simulateError();
    session.simulateDeath("dead twice over");
    session.close();
    assert.deepEqual(events, [], "no audio, transcript, state or second closed");
    assert.equal(session.canAccept(), false);
  });
}

test("simulateGoAway is a test hook that emits a reconnecting state", async () => {
  const session = new FakeTranslateSession("en");
  const states: string[] = [];
  session.on("state", (s) => states.push(s));

  session.simulateGoAway();

  assert.deepEqual(states, ["reconnecting"]);
  assert.equal(session.canAccept(), true, "GoAway alone does not close the session");
});

test("simulateDeath is a test hook that emits closed without a caller close()", async () => {
  const session = new FakeTranslateSession("en");
  let closedReason = "";
  session.on("closed", (r) => {
    closedReason = r;
  });

  session.simulateDeath("connection reset");

  assert.equal(closedReason, "connection reset");
  assert.equal(session.canAccept(), false);
});

test("simulateError is a test hook that emits an error state without closing", async () => {
  const session = new FakeTranslateSession("en");
  const states: string[] = [];
  session.on("state", (s) => states.push(s));

  session.simulateError();

  assert.deepEqual(states, ["error"]);
  assert.equal(session.canAccept(), true, "a transport error alone does not end the session");
});

test("simulateSaturated is a test hook that refuses frames without closing", async () => {
  const session = new FakeTranslateSession("en");
  const chunks: Buffer[] = [];
  session.on("audio", (c) => chunks.push(c));

  session.simulateSaturated(true);
  assert.equal(session.canAccept(), false);

  session.simulateSaturated(false);
  assert.equal(session.canAccept(), true, "backpressure clears; it is not a death");
  for (let i = 0; i < 25; i++) session.sendPcm16k(frame());
  assert.equal(chunks.length, 1, "and the session still works afterwards");
});

test("the factory hands every session it creates to onCreate", async () => {
  const created: FakeTranslateSession[] = [];
  const factory = createFakeTranslateSessionFactory((s) => created.push(s));

  const first = await factory({ targetLanguage: "en" });
  const second = await factory({ targetLanguage: "es" });

  assert.deepEqual(created, [first, second]);
  assert.equal(created[1]!.targetLanguage, "es");
});
