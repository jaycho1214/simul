import type { AudioUsage, LangCode, LanguageUsage, UsageReport } from "@simul/protocol";

/** A lane as the ledger reads it: its language and its own running count. */
export interface UsageSource {
  readonly lang: LangCode;
  readonly usage: AudioUsage;
}

/**
 * The bill for this process so far, per language.
 *
 * A lane counts its own tokens while it is open, but lanes come and go with
 * the attendees — a language nobody is listening to closes after its grace
 * period and reopens on the next tap — and the money spent on a closed lane
 * is no less spent. So the manager hands a lane's total here when it closes,
 * and a report is the retired totals plus whatever the open lanes say now.
 */
export class UsageLedger {
  private readonly retired = new Map<LangCode, AudioUsage>();

  /** `since` is the moment counting began, stamped into every report. */
  constructor(private readonly since: number) {}

  retire(lang: LangCode, usage: AudioUsage): void {
    const prior = this.retired.get(lang) ?? { inputAudioTokens: 0, outputAudioTokens: 0 };
    this.retired.set(lang, {
      inputAudioTokens: prior.inputAudioTokens + usage.inputAudioTokens,
      outputAudioTokens: prior.outputAudioTokens + usage.outputAudioTokens,
    });
  }

  /**
   * Retired totals first, in the order languages were first retired, then
   * open lanes in their own order — a stable list the operator can read
   * down without rows swapping places every second. A language that has
   * cost nothing yet is left out rather than shown as a row of zeros.
   */
  report(open: readonly UsageSource[]): UsageReport {
    const totals = new Map<LangCode, AudioUsage>();
    for (const [lang, usage] of this.retired) totals.set(lang, { ...usage });
    for (const lane of open) {
      const prior = totals.get(lane.lang) ?? { inputAudioTokens: 0, outputAudioTokens: 0 };
      totals.set(lane.lang, {
        inputAudioTokens: prior.inputAudioTokens + lane.usage.inputAudioTokens,
        outputAudioTokens: prior.outputAudioTokens + lane.usage.outputAudioTokens,
      });
    }

    const languages: LanguageUsage[] = [];
    for (const [lang, usage] of totals) {
      if (usage.inputAudioTokens === 0 && usage.outputAudioTokens === 0) continue;
      languages.push({ lang, ...usage });
    }
    return { since: this.since, languages };
  }
}
