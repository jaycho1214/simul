import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "../clock.ts";
import { FakeTranslateSession } from "./fake-translate-session.ts";
import { SessionRotator } from "./session-rotator.ts";
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

test("rotate opens a replacement and feeds both until cutover", async () => {
  const { created, factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  await rotator.rotate();
  assert.equal(created.length, 2, "a replacement session was opened");

  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  // Cutover happens on the replacement's first audio, so the old one is closed.
  assert.equal(rotator.activeIndex, 1);
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
  assert.equal(chunks.length, 1, "audio flows again once the replacement cuts over");
  assert.equal(rotator.activeIndex, 1);
});

test("an unsolicited death reconnects automatically and audio resumes after cutover", async () => {
  const { created, factory } = controllableFactory();
  const rotator = new SessionRotator("en", factory, new FakeClock());
  await rotator.start();

  const chunks: Buffer[] = [];
  rotator.on("audio", (c) => chunks.push(c));

  created[0]!.simulateDeath("connection reset");
  await flush();
  assert.equal(created.length, 2, "the dying session was replaced without caller intervention");

  for (let i = 0; i < 25; i++) rotator.sendPcm16k(Buffer.alloc(640));
  assert.equal(chunks.length, 1, "audio flows again once the replacement cuts over");
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
