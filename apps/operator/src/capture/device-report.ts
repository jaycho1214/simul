/** The three constraints the spec requires to be off, in UI order. */
export const DSP_FLAGS = ["echoCancellation", "noiseSuppression", "autoGainControl"] as const;
export type DspFlag = (typeof DSP_FLAGS)[number];

export type DeviceWarning =
  | { code: "channel_downmix"; requested: number; achieved: number }
  | { code: "channel_out_of_range"; selected: number; achieved: number }
  | { code: "dsp_enabled"; flags: DspFlag[] }
  | { code: "dsp_unreported"; flags: DspFlag[] }
  | { code: "sample_rate_mismatch"; expected: 16000; actual: number };

export interface DeviceReportInput {
  /** What we asked getUserMedia for, i.e. the device's advertised maximum. */
  requestedChannelCount: number;
  /** The splitter output the engineer picked. */
  selectedChannelIndex: number;
  /** AudioContext.sampleRate after construction. */
  contextSampleRate: number;
  /** track.getSettings() exactly as the browser returned it. */
  settings: MediaTrackSettings;
}

export interface DeviceReport {
  requestedChannelCount: number;
  achievedChannelCount: number;
  selectedChannelIndex: number;
  /** The device's own rate, before the AudioContext resamples. */
  deviceSampleRate: number | undefined;
  contextSampleRate: number;
  /** Per flag: false = reported off, true = reported on, undefined = not reported. */
  dsp: Record<DspFlag, boolean | undefined>;
  /** True only when all three flags were explicitly reported as false. */
  dspConfirmedOff: boolean;
  warnings: DeviceWarning[];
}

export function clampChannelIndex(index: number, achievedChannelCount: number): number {
  const max = Math.max(0, achievedChannelCount - 1);
  if (!Number.isFinite(index)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(index)));
}

/**
 * Turns what the browser actually gave us into something the engineer can act
 * on. Every branch here corresponds to a way an event has silently gone wrong:
 * a downmixed multichannel device, an AGC that came back on, a picked channel
 * that does not exist, or an AudioContext that refused 16 kHz.
 */
export function buildDeviceReport(input: DeviceReportInput): DeviceReport {
  const { settings } = input;
  const achievedChannelCount = settings.channelCount ?? 1;

  const dsp = {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
  } as Record<DspFlag, boolean | undefined>;

  const enabled = DSP_FLAGS.filter((flag) => dsp[flag] === true);
  const unreported = DSP_FLAGS.filter((flag) => dsp[flag] === undefined);

  const warnings: DeviceWarning[] = [];

  if (achievedChannelCount < input.requestedChannelCount) {
    warnings.push({
      code: "channel_downmix",
      requested: input.requestedChannelCount,
      achieved: achievedChannelCount,
    });
  }

  if (input.selectedChannelIndex >= achievedChannelCount) {
    warnings.push({
      code: "channel_out_of_range",
      selected: input.selectedChannelIndex,
      achieved: achievedChannelCount,
    });
  }

  if (enabled.length > 0) warnings.push({ code: "dsp_enabled", flags: enabled });
  if (unreported.length > 0) warnings.push({ code: "dsp_unreported", flags: unreported });

  if (input.contextSampleRate !== 16000) {
    warnings.push({
      code: "sample_rate_mismatch",
      expected: 16000,
      actual: input.contextSampleRate,
    });
  }

  return {
    requestedChannelCount: input.requestedChannelCount,
    achievedChannelCount,
    selectedChannelIndex: input.selectedChannelIndex,
    deviceSampleRate: settings.sampleRate,
    contextSampleRate: input.contextSampleRate,
    dsp,
    dspConfirmedOff: enabled.length === 0 && unreported.length === 0,
    warnings,
  };
}
