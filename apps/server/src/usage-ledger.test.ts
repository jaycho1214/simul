import { test } from "node:test";
import assert from "node:assert/strict";
import { UsageLedger } from "./usage-ledger.ts";

test("starts empty, stamped with when counting began", () => {
  const ledger = new UsageLedger(1_000);
  assert.deepEqual(ledger.report([]), { since: 1_000, languages: [] });
});

test("open lanes are read live and a retired lane's total is kept", () => {
  const ledger = new UsageLedger(0);
  const en = { lang: "en", usage: { inputAudioTokens: 100, outputAudioTokens: 40 } };
  const ja = { lang: "ja", usage: { inputAudioTokens: 10, outputAudioTokens: 5 } };
  assert.deepEqual(ledger.report([en, ja]).languages, [
    { lang: "en", inputAudioTokens: 100, outputAudioTokens: 40 },
    { lang: "ja", inputAudioTokens: 10, outputAudioTokens: 5 },
  ]);

  // The lane closes — grace period ran out — and its cost is still real.
  ledger.retire("en", en.usage);
  assert.deepEqual(ledger.report([ja]).languages, [
    { lang: "en", inputAudioTokens: 100, outputAudioTokens: 40 },
    { lang: "ja", inputAudioTokens: 10, outputAudioTokens: 5 },
  ]);

  // Reopened later: the new lane's live count sits on top of the retired one.
  const en2 = { lang: "en", usage: { inputAudioTokens: 7, outputAudioTokens: 3 } };
  assert.deepEqual(ledger.report([ja, en2]).languages, [
    { lang: "en", inputAudioTokens: 107, outputAudioTokens: 43 },
    { lang: "ja", inputAudioTokens: 10, outputAudioTokens: 5 },
  ]);
});

test("a lane that never cost anything is not listed", () => {
  const ledger = new UsageLedger(0);
  ledger.retire("original", { inputAudioTokens: 0, outputAudioTokens: 0 });
  assert.deepEqual(
    ledger.report([{ lang: "ko", usage: { inputAudioTokens: 0, outputAudioTokens: 0 } }]).languages,
    [],
  );
});
