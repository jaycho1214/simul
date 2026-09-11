import { describe, expect, test } from "vitest";
import { parseAdminMessage } from "./parse-admin-message.ts";

// `audioListeners` was added to LaneStatus during a server fix wave after this
// task was drafted. It is kept distinct from `listeners` throughout: it is the
// figure that falls when someone mutes, where `listeners` (max of audio and
// transcript subscriptions) does not move.
const lane = {
  lang: "es",
  listeners: 3,
  audioListeners: 2,
  state: "live",
  laneDrops: 0,
  listenerDrops: 2,
  ageMs: 12_000,
};

describe("parseAdminMessage", () => {
  test("accepts the server's lanes payload", () => {
    const parsed = parseAdminMessage(JSON.stringify({ type: "lanes", lanes: [lane] }));
    expect(parsed).toEqual({ type: "lanes", lanes: [lane] });
  });

  test("carries the server's usage report through, and reads its absence as absent", () => {
    const usage = {
      since: 1_700_000_000_000,
      languages: [{ lang: "en", inputAudioTokens: 1500, outputAudioTokens: 1500 }],
    };
    expect(parseAdminMessage(JSON.stringify({ type: "lanes", lanes: [], usage }))).toEqual({
      type: "lanes",
      lanes: [],
      usage,
    });
    // An older server sends no usage at all; the meter simply stays hidden.
    expect(parseAdminMessage(JSON.stringify({ type: "lanes", lanes: [] }))?.usage).toBeUndefined();
  });

  test("drops a malformed usage report rather than the whole frame", () => {
    const parsed = parseAdminMessage(
      JSON.stringify({
        type: "lanes",
        lanes: [lane],
        usage: { since: "yesterday", languages: [{ lang: "", inputAudioTokens: "lots" }] },
      }),
    );
    expect(parsed).toEqual({ type: "lanes", lanes: [lane] });
  });

  test("accepts an empty lane table", () => {
    expect(parseAdminMessage(JSON.stringify({ type: "lanes", lanes: [] }))).toEqual({
      type: "lanes",
      lanes: [],
    });
  });

  test("accepts a Buffer-like payload by stringifying it first", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: "lanes", lanes: [] }));
    expect(parseAdminMessage(bytes.buffer)).toEqual({ type: "lanes", lanes: [] });
  });

  test("rejects invalid JSON without throwing", () => {
    expect(parseAdminMessage("not json")).toBeUndefined();
  });

  test("rejects an unknown message type", () => {
    expect(parseAdminMessage(JSON.stringify({ type: "hello" }))).toBeUndefined();
  });

  test("rejects a payload whose lanes is not an array", () => {
    expect(parseAdminMessage(JSON.stringify({ type: "lanes", lanes: {} }))).toBeUndefined();
  });

  test("drops a malformed lane but keeps the good ones", () => {
    const parsed = parseAdminMessage(
      JSON.stringify({ type: "lanes", lanes: [lane, { lang: 42 }, { ...lane, lang: "ja" }] }),
    );
    expect(parsed?.lanes.map((l) => l.lang)).toEqual(["es", "ja"]);
  });

  test("rejects a lane with an unknown state rather than rendering it raw", () => {
    const parsed = parseAdminMessage(
      JSON.stringify({ type: "lanes", lanes: [{ ...lane, state: "exploded" }] }),
    );
    expect(parsed?.lanes).toEqual([]);
  });

  test("coerces missing counters to zero rather than undefined", () => {
    const parsed = parseAdminMessage(
      JSON.stringify({
        type: "lanes",
        lanes: [{ lang: "en", listeners: 1, state: "starting" }],
      }),
    );
    expect(parsed?.lanes[0]).toEqual({
      lang: "en",
      listeners: 1,
      audioListeners: 0,
      state: "starting",
      laneDrops: 0,
      listenerDrops: 0,
      ageMs: 0,
    });
  });
});
