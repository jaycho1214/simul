import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCompleteSentences } from "./segment-lines.ts";

test("a sentence is complete once its terminator is followed by whitespace", () => {
  assert.deepEqual(splitCompleteSentences("Hello. Today"), { done: ["Hello."], rest: "Today" });
  assert.deepEqual(splitCompleteSentences("Can you hear me? Yes"), {
    done: ["Can you hear me?"],
    rest: "Yes",
  });
});

test("a terminator at the very end is not yet a boundary", () => {
  // The next fragment decides: " Today" makes it a sentence end, "5 million"
  // makes it a decimal point. Until then the text stays in the tail.
  assert.deepEqual(splitCompleteSentences("system."), { done: [], rest: "system." });
  assert.deepEqual(splitCompleteSentences("It costs 3.5 million"), {
    done: [],
    rest: "It costs 3.5 million",
  });
});

test("several complete sentences come out in order, trimmed", () => {
  assert.deepEqual(splitCompleteSentences(" First one. Second one! Third"), {
    done: ["First one.", "Second one!"],
    rest: "Third",
  });
});

test("full-width terminators end a sentence without needing a space", () => {
  assert.deepEqual(splitCompleteSentences("こんにちは。今日は"), {
    done: ["こんにちは。"],
    rest: "今日は",
  });
  assert.deepEqual(splitCompleteSentences("你好！"), { done: ["你好！"], rest: "" });
});

test("closing quotes and brackets stay with their sentence", () => {
  assert.deepEqual(splitCompleteSentences('He said "go." Then left'), {
    done: ['He said "go."'],
    rest: "Then left",
  });
});

test("an ellipsis or a run of marks is one terminator", () => {
  assert.deepEqual(splitCompleteSentences("Well... maybe?! No"), {
    done: ["Well...", "maybe?!"],
    rest: "No",
  });
});

test("text with no terminator is all tail", () => {
  assert.deepEqual(splitCompleteSentences("still going"), { done: [], rest: "still going" });
  assert.deepEqual(splitCompleteSentences(""), { done: [], rest: "" });
});
