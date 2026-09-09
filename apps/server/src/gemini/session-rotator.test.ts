import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "../clock.ts";
import { FakeTranslateSession } from "./fake-translate-session.ts";
import { ROTATION_TIMEOUT_MS, SessionRotator } from "./session-rotator.ts";
import type { TranslateSession, TranslateSessionEvents } from "./translate-session.ts";

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
