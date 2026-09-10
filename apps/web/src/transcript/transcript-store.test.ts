import type { TranscriptLine } from "@tongyeok/protocol";
import { describe, expect, test } from "vitest";
import {
  MAX_VISIBLE_LINES,
  applyServerMessage,
  initialTranscriptState,
  transcriptReducer,
  type TranscriptState,
} from "./transcript-store.ts";

function line(seq: number, text: string, isFinal = true): TranscriptLine {
  return { seq, text, isFinal, ts: 1_000 + seq };
}

function withLines(...lines: TranscriptLine[]): TranscriptState {
  return { ...initialTranscriptState, lines };
}

describe("applyServerMessage", () => {
  test("history replaces the visible lines and keeps only the newest 50", () => {
    const lines = Array.from({ length: 200 }, (_, i) => line(i + 1, `line ${i + 1}`));
    const state = applyServerMessage(initialTranscriptState, {
      type: "history",
      lines,
    });

    expect(state.lines).toHaveLength(MAX_VISIBLE_LINES);
    expect(state.lines[0]!.text).toBe("line 151");
    expect(state.lines.at(-1)!.text).toBe("line 200");
  });

  test("an interim line is held apart and replaced by the next interim", () => {
    let state = applyServerMessage(initialTranscriptState, {
      type: "transcript",
      line: line(1, "안녕", false),
    });
    expect(state.interim?.text).toBe("안녕");
    expect(state.lines).toHaveLength(0);

    state = applyServerMessage(state, {
      type: "transcript",
      line: line(2, "안녕하세요", false),
    });
    expect(state.interim?.text).toBe("안녕하세요");
    expect(state.lines).toHaveLength(0);
  });

  test("a final line commits and clears the interim", () => {
    let state = applyServerMessage(initialTranscriptState, {
      type: "transcript",
      line: line(1, "hell", false),
    });
    state = applyServerMessage(state, {
      type: "transcript",
      line: line(2, "hello there"),
    });

    expect(state.interim).toBeNull();
    expect(state.lines.map((l) => l.text)).toEqual(["hello there"]);
  });

  test("committed lines are capped, dropping the oldest", () => {
    let state = initialTranscriptState;
    for (let i = 1; i <= MAX_VISIBLE_LINES + 5; i++) {
      state = applyServerMessage(state, { type: "transcript", line: line(i, `l${i}`) });
    }

    expect(state.lines).toHaveLength(MAX_VISIBLE_LINES);
    expect(state.lines[0]!.text).toBe("l6");
    expect(state.lines.at(-1)!.text).toBe(`l${MAX_VISIBLE_LINES + 5}`);
  });

  test("a duplicate seq is ignored", () => {
    let state = withLines(line(7, "once"));
    state = applyServerMessage(state, { type: "transcript", line: line(7, "once") });
    expect(state.lines).toHaveLength(1);
  });

  test("replaying history after a reconnect does not duplicate lines", () => {
    const state = applyServerMessage(withLines(line(1, "a"), line(2, "b")), {
      type: "history",
      lines: [line(1, "a"), line(2, "b"), line(3, "c")],
    });
    expect(state.lines.map((l) => l.text)).toEqual(["a", "b", "c"]);
  });

  test("hello clears a stale error and a stale interim", () => {
    const dirty: TranscriptState = {
      ...initialTranscriptState,
      interim: line(9, "half", false),
      error: { code: "lane_cap", message: "x" },
    };
    const state = applyServerMessage(dirty, {
      type: "hello",
      lang: "es",
      historyLines: 0,
    });

    expect(state.error).toBeNull();
    expect(state.interim).toBeNull();
  });

  test("a lane message updates laneState", () => {
    const state = applyServerMessage(initialTranscriptState, {
      type: "lane",
      state: "reconnecting",
    });
    expect(state.laneState).toBe("reconnecting");
  });

  test("an error message is stored with its code and message", () => {
    const state = applyServerMessage(initialTranscriptState, {
      type: "error",
      code: "lane_cap",
      message: "이 언어는 지금 사용할 수 없습니다 / This language is unavailable right now",
    });
    expect(state.error).toEqual({
      code: "lane_cap",
      message:
        "이 언어는 지금 사용할 수 없습니다 / This language is unavailable right now",
    });
  });
});

describe("transcriptReducer", () => {
  test("a dropped socket marks the state connecting and clears the interim", () => {
    const state = transcriptReducer(
      { ...withLines(line(1, "kept")), interim: line(2, "half", false), laneState: "live" },
      { kind: "socket", open: false },
    );

    expect(state.laneState).toBe("connecting");
    expect(state.interim).toBeNull();
    expect(state.lines.map((l) => l.text)).toEqual(["kept"]);
  });

  test("reset returns the initial state", () => {
    expect(
      transcriptReducer(withLines(line(1, "x")), { kind: "reset" }),
    ).toEqual(initialTranscriptState);
  });
});
