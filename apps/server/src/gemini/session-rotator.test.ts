import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "../clock.ts";
import { FakeTranslateSession } from "./fake-translate-session.ts";
import {
  INITIAL_RETRY_MS,
  MAX_RETRY_MS,
  ROTATION_TIMEOUT_MS,
  SessionRotator,
} from "./session-rotator.ts";
import type { TranslateSession, TranslateSessionEvents } from "./translate-session.ts";

// A note on "phase-locked" scenarios below: FakeTranslateSession completes an
// utterance every exactly-25th frame it personally receives, counted from
// whenever it started receiving them. If a replacement is opened at the
// exact instant current's own count is freshly at 0 (e.g. rotate() called
// before any frames, or right after current's own boundary), the two
// sessions' counters stay aligned from then on: every boundary current
// crosses, the replacement crosses too, in the very same sendPcm16k() call
// (every frame reaches both). That is the scenario that would double every
// cutover utterance if promotion happened mid-dispatch, so several tests
// below deliberately set it up; tests named "non-lockstep" deliberately give
// current a head start so boundaries never coincide. Both shapes must emit
// exactly one chunk and one final transcript per utterance.

function controllableFactory() {
  const created: FakeTranslateSession[] = [];
  const factory = async ({ targetLanguage }: { targetLanguage: string }) => {
    const s = new FakeTranslateSession(targetLanguage);
    created.push(s);
    return s;
  };
  return { created, factory };
}

// Lets a real (macro)task boundary pass, so promises started by a fire-and-
// forget `void this.rotate()` inside an event handler get a chance to settle.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("forwards audio from the active session", async () => {
  const { factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));

  assert.equal(chunks.length, 1);
});

test("rotate opens a replacement and cuts over on current's next boundary once the replacement is ready", async () => {
  const { created, factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  await rotator.rotate();
  assert.equal(created.length, 2, "a replacement session was opened");

  // Both sessions started fresh, so they cross their first utterance
  // boundary together: current forwards normally and the replacement only
  // becomes ready — cutover needs a boundary from current *after* that.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(rotator.activeIndex, 0, "readiness alone does not cut over");

  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(rotator.activeIndex, 1, "current's next final transcript cuts over");
});

test("emits audio exactly once per utterance across a rotation", async () => {
  const { factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));

  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  await rotator.rotate();
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 2, "no duplicated audio during the overlap");
  assert.equal(rotator.activeIndex, 0, "the replacement is only ready so far, not promoted");

  // current's next boundary completes the rotation.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 3, "still exactly one chunk per utterance, now including the cutover");
  assert.equal(rotator.activeIndex, 1);
});

test("a rotation begun on a fresh utterance boundary emits one chunk and one final transcript per utterance", async () => {
  const { factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  const chunks: Buffer[] = [];
  const finals: string[] = [];
  rotator.on("audio", (c) => chunks.push(c));
  rotator.on("transcript", (text, isFinal) => {
    if (isFinal) finals.push(text);
  });

  // Utterance 1 completes cleanly and only then does the rotation start, so
  // the replacement's 25-frame counter starts at 0 at the same instant
  // current's does. From here the two are phase-locked: every frame that
  // completes an utterance on current completes one on the replacement in
  // the very same sendPcm16k() call. A real GoAway or an unsolicited death
  // can land exactly here.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  await rotator.rotate();
  assert.equal(chunks.length, 1);
  assert.equal(finals.length, 1);

  // Utterance 2: current forwards it; the replacement crosses its own first
  // boundary in the same call and is only marked ready.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 2, "the replacement's readiness chunk is discarded, not forwarded");
  assert.equal(finals.length, 2, "and neither is its transcript");
  assert.equal(rotator.activeIndex, 0, "readiness alone does not cut over");

  // Utterance 3 is the cutover: current's final transcript arms the
  // promotion, which must not take effect until this whole dispatch is
  // done — otherwise the replacement, which completes the very same
  // utterance later in this same call, would already be `current` and would
  // emit a second chunk and a second final transcript for it.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(rotator.activeIndex, 1, "the cutover happened");
  assert.equal(chunks.length, 3, "one chunk for the cutover utterance, not two");
  assert.equal(finals.length, 3, "one final transcript for the cutover utterance, not two");

  // Utterance 4 comes from the promoted session alone, exactly once.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 4, "the promoted session is now the sole source");
  assert.equal(finals.length, 4);
});

test("a non-lockstep overlap never suppresses current, and discards the replacement's output until cutover", async () => {
  const { created, factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));

  // Build up a partial utterance on current before a replacement exists, so
  // current and the replacement cross their utterance boundaries at
  // different frame counts — the case lockstep tests can't see.
  for (let i = 0; i < 10; i++) rotator.sendPcm16k(Buffer.alloc(640));

  await rotator.rotate();
  assert.equal(created.length, 2);

  // current completes its (10 + 15 = 25) utterance before the replacement
  // has received a single utterance's worth of frames.
  for (let i = 0; i < 15; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 1, "current's own boundary is never suppressed by a pending replacement");
  assert.equal(rotator.activeIndex, 0, "the replacement isn't ready yet, so no cutover");

  // The replacement now completes its own first utterance (15 + 10 = 25)
  // while current is only 10 frames into its next one.
  for (let i = 0; i < 10; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 1, "the replacement's readiness chunk is discarded, not forwarded");
  assert.equal(rotator.activeIndex, 0, "readiness alone still doesn't cut over");

  // current's next boundary (10 + 15 = 25) is the actual cutover point.
  for (let i = 0; i < 15; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 2, "current's second utterance forwarded normally, still no duplicate");
  assert.equal(rotator.activeIndex, 1, "cutover happened on current's boundary, not on the replacement's timing");
});

test("state(reconnecting) on the active session triggers rotation without an explicit rotate() call", async () => {
  const { created, factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));

  // GoAway lands with current sitting on a fresh utterance boundary — the
  // phase-locked case, and the one a real GoAway can land on at any time.
  created[0]!.simulateGoAway();
  await flush();
  assert.equal(created.length, 2, "GoAway opened a replacement automatically");

  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 1);
  assert.equal(rotator.activeIndex, 0, "cutover waits for a boundary, not just readiness");

  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 2, "no duplicated audio; the replacement's readiness chunk was discarded");
  assert.equal(rotator.activeIndex, 1);
});

test("an unsolicited death reconnects automatically and promotes on the replacement's first audio", async () => {
  const { created, factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));

  created[0]!.simulateDeath("connection reset");
  await flush();
  assert.equal(created.length, 2, "the dying session was replaced without caller intervention");

  // current is dead, so there is no boundary to wait for — the replacement's
  // first audio is both the readiness signal and real output, and must be
  // forwarded (it duplicates nothing; current produced nothing for this
  // input).
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 1, "the replacement's first chunk is forwarded, not discarded");
  assert.equal(rotator.activeIndex, 1);
});

test("a caller-initiated close() does not trigger a reconnect", async () => {
  const { created, factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  rotator.close();
  await flush();

  assert.equal(created.length, 1, "close() must not spawn a replacement");
});

test("canAccept returns false once close() has been called", async () => {
  const { factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  assert.equal(rotator.canAccept(), true);
  rotator.close();
  assert.equal(rotator.canAccept(), false);
});

test("a second rotation trigger while a replacement is opening does not spawn a third session", async () => {
  const created: FakeTranslateSession[] = [];
  let releaseSecond: (() => void) | undefined;
  let calls = 0;
  const factory = async ({ targetLanguage }: { targetLanguage: string }) => {
    calls++;
    if (calls === 2) {
      await new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
    }
    const s = new FakeTranslateSession(targetLanguage);
    created.push(s);
    return s;
  };

  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  const firstRotate = rotator.rotate(); // begins opening the 2nd session; awaits inside the factory
  await rotator.rotate(); // concurrent trigger #1 — must be a no-op
  await rotator.rotate(); // concurrent trigger #2 — must be a no-op
  assert.equal(calls, 2, "concurrent rotate() calls did not start additional factory calls");

  releaseSecond?.();
  await firstRotate;

  assert.equal(created.length, 2, "only one replacement was ever opened");
});

test("rotate() reads resumptionHandle directly off the current session, with no cast", async () => {
  class ResumableSession implements TranslateSession {
    readonly targetLanguage = "en";
    resumptionHandle: string | undefined = "resume-abc";
    private readonly handlers: {
      [K in keyof TranslateSessionEvents]: Array<TranslateSessionEvents[K]>;
    } = { audio: [], transcript: [], state: [], closed: [] };

    on<K extends keyof TranslateSessionEvents>(event: K, fn: TranslateSessionEvents[K]): void {
      this.handlers[event].push(fn);
    }
    canAccept(): boolean {
      return true;
    }
    sendPcm16k(): void {}
    close(): void {}
  }

  const receivedOpts: Array<{ targetLanguage: string; resumeHandle?: string }> = [];
  const factory = async (opts: { targetLanguage: string; resumeHandle?: string }) => {
    receivedOpts.push(opts);
    return opts.resumeHandle
      ? new FakeTranslateSession(opts.targetLanguage)
      : new ResumableSession();
  };

  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  await rotator.rotate();

  assert.equal(receivedOpts.length, 2);
  assert.equal(receivedOpts[1]?.resumeHandle, "resume-abc");
});

test("a replacement that dies before promotion is abandoned; current keeps serving and a future rotation is possible", async () => {
  const { created, factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));

  await rotator.rotate();
  assert.equal(created.length, 2);

  // The replacement dies before it ever produces audio — never promoted.
  created[1]!.simulateDeath("replacement died before promotion");
  await flush();

  // current (the original session) is untouched and keeps serving normally.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 1, "current kept serving after the replacement was abandoned");
  assert.equal(rotator.activeIndex, 0, "no promotion happened; the dead replacement was discarded");

  // The guard was cleared, so a fresh rotation can still be started.
  await rotator.rotate();
  assert.equal(created.length, 3, "a fresh replacement can be opened after the abandoned one");
});

test("a watchdog abandons a replacement that produces no audio within the timeout", async () => {
  const { created, factory } = controllableFactory();
  const clock = new FakeClock();
  const rotator = new SessionRotator("en", factory, clock);
  await rotator.start();

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));

  await rotator.rotate();
  assert.equal(created.length, 2);

  // Never feed the replacement enough frames to reach its first utterance;
  // just let the watchdog window elapse.
  clock.advance(ROTATION_TIMEOUT_MS);

  assert.equal(created[1]!.canAccept(), false, "the abandoned replacement was closed");

  // current is untouched and keeps serving.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 1, "current kept serving after the watchdog fired");
  assert.equal(rotator.activeIndex, 0);

  // A future rotation is still possible.
  await rotator.rotate();
  assert.equal(created.length, 3);
});

test("a watchdog does not fire once the replacement has already produced audio", async () => {
  const { created, factory } = controllableFactory();
  const clock = new FakeClock();
  const rotator = new SessionRotator("en", factory, clock);
  await rotator.start();

  await rotator.rotate();
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640)); // replacement becomes ready

  clock.advance(ROTATION_TIMEOUT_MS);

  // The watchdog must not have abandoned a now-ready replacement: a further
  // boundary from current should still be able to promote it.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(rotator.activeIndex, 1, "the ready replacement was promoted, not abandoned");
  assert.equal(created.length, 2, "no extra replacement was opened");
});

test("current dying while its replacement is also failing still recovers, rather than going dark permanently", async () => {
  const { created, factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));

  await rotator.rotate();
  assert.equal(created.length, 2);

  // Double failure: current dies while the pending replacement is still
  // opening, and then that replacement dies too, before ever being ready.
  created[0]!.simulateDeath("current died mid-rotation");
  created[1]!.simulateDeath("replacement died too");
  await flush();

  assert.equal(created.length, 3, "abandoning the dead replacement while current is also dead retries immediately");

  // The third session recovers the lane.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 1, "the lane is translating again, not permanently silent");
  assert.equal(rotator.activeIndex, 1);
});

test("the promoted session receives every frame, including the one that triggered promotion", async () => {
  const { factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));

  // Same non-lockstep shape as "a non-lockstep overlap..." above.
  for (let i = 0; i < 10; i++) rotator.sendPcm16k(Buffer.alloc(640));
  await rotator.rotate();
  for (let i = 0; i < 15; i++) rotator.sendPcm16k(Buffer.alloc(640)); // current: 10+15=25
  for (let i = 0; i < 10; i++) rotator.sendPcm16k(Buffer.alloc(640)); // replacement: 15+10=25 (ready)
  for (let i = 0; i < 15; i++) rotator.sendPcm16k(Buffer.alloc(640)); // current: 10+15=25 — promotes
  assert.equal(rotator.activeIndex, 1, "promoted");
  const chunksAtCutover = chunks.length;

  // At the moment of promotion the (now-current) session has received 14
  // frames of this last batch normally, plus — if the fix works — the 15th
  // and final frame, the one whose delivery to `current` is what triggered
  // promote() in the first place. That's 15 accumulated since its own last
  // reset, so it needs exactly 10 more to reach its next boundary. If that
  // triggering frame had been dropped (the bug this test guards against),
  // it would only have 14, and would need 11, not 10.
  for (let i = 0; i < 9; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, chunksAtCutover, "9 more frames alone must not complete the next utterance");

  rotator.sendPcm16k(Buffer.alloc(640)); // the 10th
  assert.equal(
    chunks.length,
    chunksAtCutover + 1,
    "the 10th frame completes it — proving the triggering frame was not dropped",
  );
});

test("a second rotation works normally after a successful cutover", async () => {
  const { created, factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  // Complete one full, non-lockstep rotation.
  for (let i = 0; i < 10; i++) rotator.sendPcm16k(Buffer.alloc(640));
  await rotator.rotate();
  for (let i = 0; i < 15; i++) rotator.sendPcm16k(Buffer.alloc(640));
  for (let i = 0; i < 10; i++) rotator.sendPcm16k(Buffer.alloc(640));
  for (let i = 0; i < 15; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(rotator.activeIndex, 1, "first rotation completed");
  assert.equal(created.length, 2);

  // A second rotation must still work: open a fresh replacement and
  // eventually promote it, exactly like the first one did.
  await rotator.rotate();
  assert.equal(created.length, 3, "a second rotation opens a fresh replacement");

  // Feed comfortably more than two utterances' worth of frames — enough for
  // the still-current session (whatever frame offset it's left at) to cross
  // a boundary, the new replacement to become ready, and a further boundary
  // to cut over, regardless of exact alignment.
  for (let i = 0; i < 100; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(rotator.activeIndex, 2, "the second rotation also promoted its replacement");
});

test("a factory rejection does not escape rotate(): current keeps serving and a retry is scheduled", async (t) => {
  const errorMock = t.mock.method(console, "error", () => {});

  let calls = 0;
  const created: FakeTranslateSession[] = [];
  const factory = async ({ targetLanguage }: { targetLanguage: string }) => {
    calls++;
    if (calls === 2) throw new Error("connect ECONNREFUSED"); // the rotate() attempt, not start()
    const s = new FakeTranslateSession(targetLanguage);
    created.push(s);
    return s;
  };

  const clock = new FakeClock();
  const rotator = new SessionRotator("en", factory, clock);
  await rotator.start(); // call 1: succeeds

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));

  // rotate() must not throw or produce an unhandled rejection.
  await assert.doesNotReject(() => rotator.rotate()); // call 2: fails
  assert.equal(calls, 2, "the failed attempt was made");
  assert.equal(errorMock.mock.callCount(), 1, "the rejection was logged, not thrown");
  const [msg] = errorMock.mock.calls[0]!.arguments;
  assert.match(String(msg), /\ben\b/, "the log identifies which language's lane failed");

  // current is untouched and keeps serving despite the rejection.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 1, "current kept serving after the factory rejection");

  // The retry is scheduled, not immediate.
  assert.equal(calls, 2, "no retry has fired yet");
  clock.advance(INITIAL_RETRY_MS);
  await flush();
  assert.equal(calls, 3, "the scheduled retry fired");
  assert.equal(created.length, 2, "the retry succeeded and opened a replacement");
});

test("a persistently failing factory backs off exponentially, capped, and current is never disturbed", async (t) => {
  const errorMock = t.mock.method(console, "error", () => {});

  let calls = 0;
  const factory = async ({ targetLanguage }: { targetLanguage: string }) => {
    calls++;
    if (calls === 1) return new FakeTranslateSession(targetLanguage); // start()'s own session
    throw new Error(`attempt ${calls} failed`);
  };

  const clock = new FakeClock();
  const rotator = new SessionRotator("en", factory, clock);
  await rotator.start(); // call 1: succeeds

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));

  await rotator.rotate(); // call 2: fails
  assert.equal(calls, 2);

  clock.advance(INITIAL_RETRY_MS - 1);
  await flush();
  assert.equal(calls, 2, "no retry before the first backoff delay elapses");

  // 1s, 2s, 4s, 8s, 16s, then capped at 30s — and the cap holds on the next
  // one too, proving it doesn't keep doubling past MAX_RETRY_MS.
  const delays = [1, 2000, 4000, 8000, 16000, MAX_RETRY_MS, MAX_RETRY_MS];
  for (let i = 0; i < delays.length; i++) {
    clock.advance(delays[i]!);
    await flush();
    assert.equal(calls, i + 3, `retried on schedule`);
  }

  // current was never touched by any of this.
  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 1, "current kept serving through a long run of factory failures");
  assert.equal(errorMock.mock.callCount(), 8, "every one of the 8 failures was logged, none thrown");
});

test("backoff resets to the initial delay after the factory succeeds", async (t) => {
  const errorMock = t.mock.method(console, "error", () => {});

  let calls = 0;
  const created: FakeTranslateSession[] = [];
  const factory = async ({ targetLanguage }: { targetLanguage: string }) => {
    calls++;
    // Call 1 is start()'s own session and must succeed. Then: fail, fail,
    // succeed (the replacement), then fail again after it's abandoned.
    if (calls === 2 || calls === 3 || calls === 5) throw new Error(`attempt ${calls} failed`);
    const s = new FakeTranslateSession(targetLanguage);
    created.push(s);
    return s;
  };

  const clock = new FakeClock();
  const rotator = new SessionRotator("en", factory, clock);
  await rotator.start(); // call 1: succeeds
  assert.equal(created.length, 1);

  await rotator.rotate(); // call 2: fails; schedules a retry at 1000ms
  clock.advance(INITIAL_RETRY_MS);
  await flush(); // call 3: fails; schedules a retry at 2000ms (doubled)
  clock.advance(2000);
  await flush(); // call 4: succeeds
  assert.equal(calls, 4);
  assert.equal(created.length, 2, "the replacement succeeded on the second retry");

  // Abandon the pending replacement so a fresh rotation can be attempted.
  created[1]!.simulateDeath("abandon to re-test backoff");
  await flush();

  await rotator.rotate(); // call 5: fails
  assert.equal(calls, 5);

  // Had backoff not reset after the call-4 success, this would need 4000ms
  // (doubled again from 2000). Confirm it only needs the initial 1000ms.
  clock.advance(INITIAL_RETRY_MS - 1);
  await flush();
  assert.equal(calls, 5, "no retry yet");
  clock.advance(1);
  await flush();
  assert.equal(calls, 6, "backoff reset to the initial delay after the earlier success");
  assert.equal(errorMock.mock.callCount(), 3, "calls 2, 3, and 5 each logged their failure");
});
