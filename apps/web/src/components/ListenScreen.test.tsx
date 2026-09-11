import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { UNBRANDED } from "../config.ts";
import { muteLabels } from "../languages.ts";
import { S, bilingual } from "../strings.ts";
import { initialTranscriptState } from "../transcript/transcript-store.ts";
import { ListenScreen } from "./ListenScreen.tsx";
import { MuteButton } from "./MuteButton.tsx";
import { SilentSwitchNotice } from "./SilentSwitchNotice.tsx";
import { bannerText } from "./StatusBanner.tsx";

const healthy = {
  laneState: "live" as const,
  audioStatus: "playing" as const,
  error: null,
};

describe("bannerText", () => {
  test("a lane_cap error outranks everything else", () => {
    expect(
      bannerText({
        ...healthy,
        laneState: "reconnecting",
        audioStatus: "stalled",
        error: { code: "lane_cap", message: "ignored" },
      }),
    ).toEqual({ text: S.laneCap, tone: "error" });
  });

  test("an unknown_language error is reported in both languages", () => {
    expect(bannerText({ ...healthy, error: { code: "unknown_language", message: "x" } })).toEqual({
      text: S.unknownLanguage,
      tone: "error",
    });
  });

  test("a reconnecting lane shows the spec's reconnecting text", () => {
    expect(bannerText({ ...healthy, laneState: "reconnecting" })).toEqual({
      text: "재연결 중 / Reconnecting",
      tone: "warn",
    });
  });

  test("a lane in error is surfaced", () => {
    expect(bannerText({ ...healthy, laneState: "error" }).tone).toBe("error");
  });

  test("failed audio prompts for a tap, stalled audio reports reconnecting", () => {
    expect(bannerText({ ...healthy, audioStatus: "failed" })).toEqual({
      text: S.tapToPlay,
      tone: "warn",
    });
    expect(bannerText({ ...healthy, audioStatus: "stalled" })).toEqual({
      text: S.audioStalled,
      tone: "warn",
    });
  });

  test("a starting or connecting lane is reported as such", () => {
    expect(bannerText({ ...healthy, laneState: "starting" }).text).toBe(S.starting);
    expect(bannerText({ ...healthy, laneState: "connecting" }).text).toBe(S.connecting);
  });

  test("reports live when everything is healthy", () => {
    expect(bannerText(healthy)).toEqual({ text: S.live, tone: "ok" });
  });
});

describe("MuteButton", () => {
  test("flips its label and aria-pressed, in the reader's language", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<MuteButton lang="ja" muted={false} onToggle={onToggle} />);

    const button = screen.getByRole("button");
    expect(button.textContent).toBe("ミュート");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<MuteButton lang="ja" muted onToggle={onToggle} />);
    expect(screen.getByRole("button").textContent).toBe("ミュート解除");
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  test("keeps the bilingual label on the passthrough lane, which is not a language", () => {
    render(<MuteButton lang="original" muted={false} onToggle={() => {}} />);
    expect(screen.getByRole("button").textContent).toBe(S.mute);
  });
});

describe("SilentSwitchNotice", () => {
  test("renders both halves of the warning when open", () => {
    render(<SilentSwitchNotice open foldable={false} onToggle={() => {}} />);
    const { ko, en } = bilingual(S.silentSwitchBody);
    expect(screen.getByText(S.silentSwitchTitle)).toBeTruthy();
    expect(screen.getByText(ko)).toBeTruthy();
    expect(screen.getByText(en)).toBeTruthy();
  });

  // The whole point of the notice is that its reader cannot tell whether the
  // system is working, so while audio has not played there must be no way to
  // make it go away.
  test("offers no way out while folding is not allowed", () => {
    render(<SilentSwitchNotice open foldable={false} onToggle={() => {}} />);
    expect(screen.getByRole("note")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("becomes a control once audio has been heard", () => {
    const onToggle = vi.fn();
    render(<SilentSwitchNotice open foldable onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test("folded, it keeps the question on screen and reopens on tap", () => {
    const onToggle = vi.fn();
    render(<SilentSwitchNotice open={false} foldable onToggle={onToggle} />);

    const button = screen.getByRole("button");
    expect(button.textContent).toContain(S.silentSwitchTitle);
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("ListenScreen", () => {
  function renderScreen(overrides: Partial<Parameters<typeof ListenScreen>[0]> = {}) {
    const props = {
      brand: UNBRANDED,
      lang: "es",
      endonym: "Español",
      muted: false,
      audioStatus: "playing" as const,
      transcript: initialTranscriptState,
      onToggleMute: vi.fn(),
      onBack: vi.fn(),
      onRetry: vi.fn(),
      ...overrides,
    };
    render(<ListenScreen {...props} />);
    return props;
  }

  test("holds the silent-switch notice open, undismissible, until audio plays", () => {
    renderScreen({ audioStatus: "idle" });
    expect(screen.getByRole("note").textContent).toContain(S.silentSwitchTitle);
    expect(screen.queryByText("닫기 / Dismiss")).toBeNull();
  });

  test("folds the notice away once audio is playing, and reopens it on tap", () => {
    renderScreen({ audioStatus: "playing" });

    const folded = screen.getByRole("button", { name: S.silentSwitchTitle });
    expect(folded.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(bilingual(S.silentSwitchBody).ko)).toBeNull();

    fireEvent.click(folded);
    expect(screen.getByText(bilingual(S.silentSwitchBody).ko)).toBeTruthy();
  });

  // Audio that was playing and then stopped puts the reader right back in the
  // situation the notice exists for, so it must come back on its own.
  test("reopens the notice when audio stalls after playing", () => {
    renderScreen({ audioStatus: "stalled" });
    expect(screen.getByRole("note")).toBeTruthy();
  });

  test("shows the chosen language in its own script", () => {
    renderScreen();
    expect(screen.getByText("Español")).toBeTruthy();
  });

  // The way back used to be the language readout itself, with its label
  // hidden and only a chevron to hint at it, and nobody found it. It is a
  // labelled button now and this test holds it to that: findable by its words,
  // not by knowing which decoration to tap.
  test("offers a visibly labelled way back to the picker", () => {
    const props = renderScreen();

    const back = screen.getByRole("button", { name: S.changeLanguage });
    expect(back.textContent).toBe(S.changeShort);

    fireEvent.click(back);
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  // A working session says so, in one quiet line: the lamp alone left the
  // reader unable to tell a live lane from one that had merely gone quiet.
  test("shows a visible live line when healthy", () => {
    renderScreen({
      transcript: { ...initialTranscriptState, laneState: "live" },
    });

    const status = screen.getByRole("status");
    expect(status.textContent).toBe(S.live);
    expect(status.className).toContain("status--ok");
    expect(status.className).not.toContain("visually-hidden");
  });

  // "Live" must mean live and connected: a dropped socket reads as
  // connecting, so the line changes the moment the phone stops receiving.
  test("drops the live line while the socket is closed", () => {
    renderScreen({
      transcript: { ...initialTranscriptState, laneState: "connecting" },
    });

    const status = screen.getByRole("status");
    expect(status.textContent).toContain(S.connecting);
    expect(status.className).not.toContain("status--ok");
  });

  test("gives a failing lane a visible band with words in it", () => {
    renderScreen({
      transcript: {
        ...initialTranscriptState,
        laneState: "reconnecting",
      },
    });

    const status = screen.getByRole("status");
    expect(status.textContent).toContain(S.reconnecting);
    expect(status.className).toContain("status--warn");
  });

  test("renders the transcript and the mute control together, with no mode choice", () => {
    renderScreen({
      transcript: {
        ...initialTranscriptState,
        laneState: "live",
        lines: [{ seq: 1, text: "hola", isFinal: true, ts: 1 }],
      },
    });

    expect(screen.getByText("hola")).toBeTruthy();
    expect(screen.getByText(muteLabels("es").mute)).toBeTruthy();
    expect(screen.queryByText(/mode/i)).toBeNull();
  });

  test("offers a retry only when the lane reported an error", () => {
    renderScreen();
    expect(screen.queryByText(S.retry)).toBeNull();
    cleanup();

    const props = renderScreen({
      transcript: {
        ...initialTranscriptState,
        error: { code: "lane_cap", message: S.laneCap },
      },
    });
    fireEvent.click(screen.getByText(S.retry));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});
