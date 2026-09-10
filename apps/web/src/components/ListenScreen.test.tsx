import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { S } from "../strings.ts";
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
    expect(
      bannerText({ ...healthy, error: { code: "unknown_language", message: "x" } }),
    ).toEqual({ text: S.unknownLanguage, tone: "error" });
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
  test("flips its bilingual label and aria-pressed", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<MuteButton muted={false} onToggle={onToggle} />);

    const button = screen.getByRole("button");
    expect(button.textContent).toBe(S.mute);
    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<MuteButton muted onToggle={onToggle} />);
    expect(screen.getByRole("button").textContent).toBe(S.unmute);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("SilentSwitchNotice", () => {
  test("renders both halves of the warning", () => {
    render(<SilentSwitchNotice />);
    expect(screen.getByText(S.silentSwitchTitle)).toBeTruthy();
    expect(screen.getByText(S.silentSwitchBody)).toBeTruthy();
  });
});

describe("ListenScreen", () => {
  function renderScreen(overrides: Partial<Parameters<typeof ListenScreen>[0]> = {}) {
    const props = {
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

  test("always shows the silent-switch notice — it is never dismissible", () => {
    renderScreen();
    expect(screen.getByRole("note").textContent).toContain(S.silentSwitchTitle);
    expect(screen.queryByText("닫기 / Dismiss")).toBeNull();
  });

  test("shows the chosen language in its own script and offers a way back", () => {
    const props = renderScreen();
    expect(screen.getByText("Español")).toBeTruthy();

    fireEvent.click(screen.getByText(S.changeLanguage));
    expect(props.onBack).toHaveBeenCalledTimes(1);
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
    expect(screen.getByText(S.mute)).toBeTruthy();
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
