import { test } from "node:test";
import assert from "node:assert/strict";
import type { GoogleGenAI, LiveServerMessage } from "@google/genai";
import { FakeClock } from "../clock.ts";
import { GeminiTranslateSession, TRANSCRIPT_IDLE_MS } from "./gemini-translate-session.ts";

// These tests need no API key and open no socket: `connect()` takes the
// GoogleGenAI client as a parameter, so a stand-in can capture the callbacks
// the session registers and then drive them exactly as the SDK would.

type LiveCallbacks = {
  onmessage: (message: LiveServerMessage) => void;
  onerror: (e: { message?: string }) => void;
  onclose: (e: { code?: number; reason?: string }) => void;
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
  const session = new GeminiTranslateSession("en", new FakeClock());
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
  const session = new GeminiTranslateSession("en", new FakeClock());
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
  const session = new GeminiTranslateSession("en", new FakeClock());
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

// @google/genai 2.21.0, dist/genai.d.ts:14896:
//   /** Audio transcription in Server Content. */
//   export declare interface Transcription {
//     /** Optional. Transcription text. */          text?: string;
//     /** Optional. The bool indicates the end of the transcription. */
//                                                   finished?: boolean;
//     ...
//   }
// and at :10310, on LiveServerContent:
//   /** Output transcription. The transcription is independent to the model
//    turn which means it doesn't imply any ordering between transcription and
//    model turn. */                                 outputTranscription?: Transcription;
//
// So `turnComplete` answers a different question than the one being asked —
// it is about the model's *turn*, which the SDK documents as carrying no
// ordering relationship to the transcription at all. `finished` is the
// transcription's own end-of-line flag, and it is what decides finality here.
test("a transcription that reports itself finished is final, with or without turnComplete", async () => {
  const gen = fakeGenAI();
  const session = new GeminiTranslateSession("en", new FakeClock());
  await session.connect({ ai: gen.ai, model: "test-model" });
  const events = record(session);

  // Fragments, not repeats of the whole line — see "reassembles a chunked
  // transcription" below for why that distinction is the whole ballgame.
  gen.live().onmessage({
    serverContent: { outputTranscription: { text: "buenos", finished: false } },
  } as LiveServerMessage);
  gen.live().onmessage({
    serverContent: { outputTranscription: { text: " días", finished: true } },
  } as LiveServerMessage);

  // If `finished: true` without `turnComplete` publishes as interim — the
  // SDK's documented normal case — TranscriptBus stores nothing, `history()`
  // stays empty for the whole event, and every attendee who joins late, or
  // reconnects after a tunnel, gets a blank transcript pane.
  assert.deepEqual(events, ["transcript:buenos:false", "transcript:buenos días:true"]);
});

test("an unfinished transcription stays interim even when the model's turn completed", async () => {
  const gen = fakeGenAI();
  const session = new GeminiTranslateSession("en", new FakeClock());
  await session.connect({ ai: gen.ai, model: "test-model" });
  const events = record(session);

  // The two flags disagree, and the transcription's own flag wins: the model
  // being done generating says nothing about whether this line of transcript
  // is complete.
  gen.live().onmessage({
    serverContent: { outputTranscription: { text: "med", finished: false }, turnComplete: true },
  } as LiveServerMessage);

  assert.deepEqual(events, ["transcript:med:false"]);
});

test("turnComplete is still the fallback when the transcription omits finished", async () => {
  const gen = fakeGenAI();
  const session = new GeminiTranslateSession("en", new FakeClock());
  await session.connect({ ai: gen.ai, model: "test-model" });
  const events = record(session);

  gen.live().onmessage({
    serverContent: { outputTranscription: { text: "interim" } },
  } as LiveServerMessage);
  gen.live().onmessage({
    serverContent: { outputTranscription: { text: " settled" }, turnComplete: true },
  } as LiveServerMessage);

  assert.deepEqual(events, ["transcript:interim:false", "transcript:interim settled:true"]);
});

/**
 * Gemini streams a transcription as a run of fragments. `finished` marks the
 * end of one when it is sent — the translate model never sends it, and the
 * session cuts lines itself (see the tests at the bottom of this file), but
 * the flag is still honoured for a model that does.
 *
 * Everything downstream of this class assumes the opposite: TranscriptBus
 * stores what it is handed as a finished line, the wire protocol sends whole
 * lines, and the attendee app replaces its interim line wholesale on every
 * message. So the fragments have to be reassembled here, at the one boundary
 * that knows Gemini's wire format, rather than leaking that format through
 * three layers that have no reason to know it.
 *
 * Emitted verbatim, an attendee saw one word at a time and no line ever
 * scrolled up: each fragment replaced the last as the interim, and only the
 * final fragment was ever committed as a "line".
 */
test("reassembles a chunked transcription into one growing line", async () => {
  const { ai, live } = fakeGenAI();
  const session = new GeminiTranslateSession("es", new FakeClock());
  const seen: Array<[string, boolean]> = [];
  session.on("transcript", (text, isFinal) => seen.push([text, isFinal]));
  await session.connect({ ai, model: "m" });

  for (const [text, finished] of [
    ["Grace", false],
    [" be with", false],
    [" you always.", true],
  ] as const) {
    live().onmessage({
      serverContent: { outputTranscription: { text, finished } },
    } as LiveServerMessage);
  }

  assert.deepEqual(seen, [
    ["Grace", false],
    ["Grace be with", false],
    ["Grace be with you always.", true],
  ]);
});

test("starts a new line after a finished one", async () => {
  const { ai, live } = fakeGenAI();
  const session = new GeminiTranslateSession("es", new FakeClock());
  const seen: Array<[string, boolean]> = [];
  session.on("transcript", (text, isFinal) => seen.push([text, isFinal]));
  await session.connect({ ai, model: "m" });

  const send = (text: string, finished: boolean) =>
    live().onmessage({
      serverContent: { outputTranscription: { text, finished } },
    } as LiveServerMessage);

  send("First.", true);
  send("Second", false);
  send(" one.", true);

  assert.deepEqual(seen, [
    ["First.", true],
    ["Second", false],
    ["Second one.", true],
  ]);
});

// `finished` is optional. When it is absent the class already falls back to
// turnComplete, and that fallback has to end the accumulated line too — or the
// next utterance is appended to this one forever.
test("ends an accumulated line on turnComplete when finished is absent", async () => {
  const { ai, live } = fakeGenAI();
  const session = new GeminiTranslateSession("es", new FakeClock());
  const seen: Array<[string, boolean]> = [];
  session.on("transcript", (text, isFinal) => seen.push([text, isFinal]));
  await session.connect({ ai, model: "m" });

  live().onmessage({
    serverContent: { outputTranscription: { text: "Half" } },
  } as LiveServerMessage);
  live().onmessage({
    serverContent: { outputTranscription: { text: " a line." }, turnComplete: true },
  } as LiveServerMessage);
  live().onmessage({
    serverContent: { outputTranscription: { text: "Next." }, turnComplete: true },
  } as LiveServerMessage);

  assert.deepEqual(seen, [
    ["Half", false],
    ["Half a line.", true],
    ["Next.", true],
  ]);
});

// The SDK's connect() never rejects: a handshake the server refuses leaves it
// pending forever, and only SessionRotator's 10 s timeout ends the wait, with
// nothing to say about why. An invalid API key is the concrete case — Google
// opens the socket, then closes it with code 1007 and the reason in the frame
// about 300 ms later (measured 2026-09-11) — and it must surface as that
// reason, at once, in the operator's log.
function hangingGenAI() {
  let callbacks: LiveCallbacks | undefined;
  const ai = {
    live: {
      connect: (opts: { callbacks: LiveCallbacks }) => {
        callbacks = opts.callbacks;
        return new Promise<never>(() => {});
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

test("a socket the server closes before setup rejects connect() at once, with the server's reason", async () => {
  const gen = hangingGenAI();
  const session = new GeminiTranslateSession("en", new FakeClock());

  const connecting = session.connect({ ai: gen.ai, model: "test-model" });
  gen.live().onclose({ code: 1007, reason: "API key not valid. Please pass a valid API key." });

  await assert.rejects(connecting, /API key not valid/);
  assert.equal(session.canAccept(), false, "the session is dead, not half-open");
});

test("a handshake error rejects connect() at once too", async () => {
  const gen = hangingGenAI();
  const session = new GeminiTranslateSession("en", new FakeClock());

  const connecting = session.connect({ ai: gen.ai, model: "test-model" });
  gen.live().onerror({ message: "Unexpected server response: 403" });

  await assert.rejects(connecting, /403/);
});

test("a close with no reason still names the close code", async () => {
  const gen = hangingGenAI();
  const session = new GeminiTranslateSession("en", new FakeClock());

  const connecting = session.connect({ ai: gen.ai, model: "test-model" });
  gen.live().onclose({ code: 1006 });

  await assert.rejects(connecting, /code 1006/);
});

// There is no source language in this API; the model detects what is spoken.
// Without echo, a lane goes silent whenever the speaker happens to already be
// speaking its language — an English listener would hear nothing during an
// English passage — so every lane asks for the parrot.
test("every session asks the model to echo speech already in its target language", async () => {
  let config:
    | { translationConfig?: { echoTargetLanguage?: boolean; targetLanguageCode?: string } }
    | undefined;
  const ai = {
    live: {
      connect: async (opts: { config: typeof config }) => {
        config = opts.config;
        return { sendRealtimeInput: () => {}, close: () => {} };
      },
    },
  };
  const session = new GeminiTranslateSession("es", new FakeClock());

  await session.connect({ ai: ai as unknown as GoogleGenAI, model: "test-model" });

  assert.equal(config?.translationConfig?.targetLanguageCode, "es");
  assert.equal(config?.translationConfig?.echoTargetLanguage, true);
});

// The translate model never sends `finished` or `turnComplete` — it
// translates a continuous stream with no turns to close (measured 2026-09-11
// against the real API: none across two sentences and a 45 s pause). The
// fragments below are the ones it actually sent for the first sentence of
// that run. Without cutting lines here, the attendee's transcript was one
// line that grew for the whole event.
function fragmentSender(gen: ReturnType<typeof fakeGenAI>) {
  return (text: string) =>
    gen.live().onmessage({
      serverContent: { outputTranscription: { text, languageCode: "en" } },
    } as LiveServerMessage);
}

test("cuts a line at each sentence the fragments complete, keeping the rest interim", async () => {
  const gen = fakeGenAI();
  const clock = new FakeClock();
  const session = new GeminiTranslateSession("en", clock);
  await session.connect({ ai: gen.ai, model: "test-model" });
  const events = record(session);
  const send = fragmentSender(gen);

  send("Hello. Today");
  assert.deepEqual(events, ["transcript:Hello.:true", "transcript:Today:false"]);
  events.length = 0;

  send(" we're going to talk");
  send(" about a real-time");
  assert.deepEqual(events, [
    "transcript:Today we're going to talk:false",
    "transcript:Today we're going to talk about a real-time:false",
  ]);
  events.length = 0;

  // A full stop with nothing after it is not yet a boundary: the next
  // fragment decides whether it ended a sentence or sat inside "3.5".
  send(" system.");
  assert.deepEqual(events, [
    "transcript:Today we're going to talk about a real-time system.:false",
  ]);
  events.length = 0;

  send(" Can you hear me clearly?");
  assert.deepEqual(events, [
    "transcript:Today we're going to talk about a real-time system.:true",
    "transcript:Can you hear me clearly?:false",
  ]);
});

test("commits the tail once the speaker has paused", async () => {
  const gen = fakeGenAI();
  const clock = new FakeClock();
  const session = new GeminiTranslateSession("en", clock);
  await session.connect({ ai: gen.ai, model: "test-model" });
  const events = record(session);
  const send = fragmentSender(gen);

  send("Can you hear me clearly?");
  clock.advance(TRANSCRIPT_IDLE_MS - 1);
  assert.deepEqual(events, ["transcript:Can you hear me clearly?:false"]);

  clock.advance(1);
  assert.deepEqual(events, [
    "transcript:Can you hear me clearly?:false",
    "transcript:Can you hear me clearly?:true",
  ]);

  // Nothing is pending any more, so a longer silence commits nothing twice.
  clock.advance(TRANSCRIPT_IDLE_MS * 5);
  assert.equal(events.length, 2);
});

test("a fragment arriving before the pause is up keeps the line open", async () => {
  const gen = fakeGenAI();
  const clock = new FakeClock();
  const session = new GeminiTranslateSession("en", clock);
  await session.connect({ ai: gen.ai, model: "test-model" });
  const events = record(session);
  const send = fragmentSender(gen);

  send("let's take");
  clock.advance(TRANSCRIPT_IDLE_MS - 1);
  send(" a short break");
  clock.advance(TRANSCRIPT_IDLE_MS - 1);
  assert.deepEqual(events, [
    "transcript:let's take:false",
    "transcript:let's take a short break:false",
  ]);

  clock.advance(1);
  assert.equal(events.at(-1), "transcript:let's take a short break:true");
});

// During silence the model sends `outputTranscription` with no text at all
// (measured: about every two seconds). They carry nothing, and they must not
// keep resetting the pause either, or a line spoken right before a silence
// would never commit.
test("empty transcription ticks neither append nor postpone the pause", async () => {
  const gen = fakeGenAI();
  const clock = new FakeClock();
  const session = new GeminiTranslateSession("en", clock);
  await session.connect({ ai: gen.ai, model: "test-model" });
  const events = record(session);
  const send = fragmentSender(gen);

  send("and then I'll say it again");
  clock.advance(TRANSCRIPT_IDLE_MS - 500);
  gen.live().onmessage({
    serverContent: { outputTranscription: { languageCode: "en" } },
  } as LiveServerMessage);
  assert.deepEqual(events, ["transcript:and then I'll say it again:false"]);

  clock.advance(500);
  assert.equal(events.at(-1), "transcript:and then I'll say it again:true");
});

test("the pause timer is disarmed by every way a session can close", async () => {
  for (const closeIt of [
    (session: GeminiTranslateSession, _gen: ReturnType<typeof fakeGenAI>) => session.close(),
    (_session: GeminiTranslateSession, gen: ReturnType<typeof fakeGenAI>) =>
      gen.live().onclose({ reason: "connection reset" }),
  ]) {
    const gen = fakeGenAI();
    const clock = new FakeClock();
    const session = new GeminiTranslateSession("en", clock);
    await session.connect({ ai: gen.ai, model: "test-model" });
    const events = record(session);

    fragmentSender(gen)("half a line");
    closeIt(session, gen);
    events.length = 0;

    // A closed session is inert (translate-session.ts): the tail must not
    // surface as a final line after the rotator has already moved on.
    clock.advance(TRANSCRIPT_IDLE_MS * 2);
    assert.deepEqual(events, []);
  }
});
