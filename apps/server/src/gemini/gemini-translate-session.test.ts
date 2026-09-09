import { test } from "node:test";
import assert from "node:assert/strict";
import type { GoogleGenAI, LiveServerMessage } from "@google/genai";
import { GeminiTranslateSession } from "./gemini-translate-session.ts";

// These tests need no API key and open no socket: `connect()` takes the
// GoogleGenAI client as a parameter, so a stand-in can capture the callbacks
// the session registers and then drive them exactly as the SDK would.

type LiveCallbacks = {
  onmessage: (message: LiveServerMessage) => void;
  onerror: (e: { message?: string }) => void;
  onclose: (e: { reason?: string }) => void;
};

function fakeGenAI() {
  let callbacks: LiveCallbacks | undefined;
  const ai = {
    live: {
      connect: async (opts: { callbacks: LiveCallbacks }) => {
        callbacks = opts.callbacks;
        return { sendRealtimeInput: () => {}, close: () => {} };
      },
    },
  };
  return {
    ai: ai as unknown as GoogleGenAI,
    live: (): LiveCallbacks => {
      assert.ok(callbacks, "connect() registered its callbacks");
      return callbacks;
    },
  };
}

/** One audio part plus a final transcript — the shape of a real turn. */
const turn = (text: string): LiveServerMessage =>
  ({
    serverContent: {
      outputTranscription: { text },
      turnComplete: true,
      modelTurn: { parts: [{ inlineData: { data: Buffer.from("pcm").toString("base64") } }] },
    },
  }) as LiveServerMessage;

function record(session: GeminiTranslateSession): string[] {
  const events: string[] = [];
  session.on("audio", (pcm) => events.push(`audio:${pcm.length}`));
  session.on("transcript", (text, isFinal) => events.push(`transcript:${text}:${isFinal}`));
  session.on("state", (s) => events.push(`state:${s}`));
  session.on("closed", (reason) => events.push(`closed:${reason}`));
  return events;
}

test("a session that has died emits nothing further, however late the message arrives", async () => {
  const gen = fakeGenAI();
  const session = new GeminiTranslateSession("en");
  await session.connect({ ai: gen.ai, model: "test-model" });
  const events = record(session);

  // While live, messages are forwarded — otherwise the silence asserted below
  // would prove nothing.
  gen.live().onmessage(turn("hola"));
  assert.deepEqual(events, ["transcript:hola:true", "audio:3"]);

  gen.live().onclose({ reason: "connection reset" });
  assert.deepEqual(events, ["transcript:hola:true", "audio:3", "closed:connection reset"]);
  events.length = 0;

  // Messages already in flight when the connection died still arrive. A
  // closed session must swallow them: SessionRotator keeps a dead `current`
  // in place until the cutover lands, so anything emitted here would be
  // forwarded alongside the replacement's output — a duplicate in exactly the
  // window make-before-break exists to keep seamless.
  gen.live().onmessage(turn("late"));
  gen.live().onmessage({ goAway: { timeLeft: "1s" } } as LiveServerMessage);
  session.sendPcm16k(Buffer.alloc(640));
  assert.deepEqual(events, [], "a dead session emits no audio, transcript or state");
});

test("a closed session emits nothing further, including on the error path", async (t) => {
  const errorMock = t.mock.method(console, "error", () => {});
  const gen = fakeGenAI();
  const session = new GeminiTranslateSession("en");
  await session.connect({ ai: gen.ai, model: "test-model" });
  const events = record(session);

  // While live, an error is reported as such.
  gen.live().onerror({ message: "socket hang up" });
  assert.deepEqual(events, ["state:error"]);
  assert.equal(errorMock.mock.callCount(), 1, "the error was logged, not swallowed, while live");
  events.length = 0;

  session.close();
  assert.deepEqual(events, ["closed:closed by caller"]);
  events.length = 0;

  gen.live().onerror({ message: "socket hang up, again" });
  gen.live().onmessage(turn("after close"));
  gen.live().onclose({ reason: "server acknowledged the close" });
  assert.deepEqual(events, [], "close() ends the event stream for good");
  assert.equal(errorMock.mock.callCount(), 1, "no further error logs after close either");
});

test("a resumption handle is captured while live", async () => {
  const gen = fakeGenAI();
  const session = new GeminiTranslateSession("en");
  await session.connect({ ai: gen.ai, model: "test-model" });

  assert.equal(session.resumptionHandle, undefined);
  gen.live().onmessage({
    sessionResumptionUpdate: { resumable: true, newHandle: "handle-1" },
  } as LiveServerMessage);
  assert.equal(session.resumptionHandle, "handle-1", "SessionRotator resumes from this");

  // SessionRotator reads the handle the moment `current` dies, so a handle
  // arriving after that is for a connection nobody can resume; the session is
  // silent and inert once closed.
  gen.live().onclose({ reason: "connection reset" });
  gen.live().onmessage({
    sessionResumptionUpdate: { resumable: true, newHandle: "handle-2" },
  } as LiveServerMessage);
  assert.equal(session.resumptionHandle, "handle-1", "a post-mortem handle is ignored");
});
