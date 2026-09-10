import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App.tsx";
import { S } from "./strings.ts";

class StubSocket {
  readyState = 1;
  constructor(readonly url: string) {}
  addEventListener(): void {}
  close(): void {}
}

const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();
const load = vi.fn();

beforeEach(() => {
  // jsdom has no media pipeline at all, so the three methods the controller
  // touches are stubbed. This test covers wiring, not playback.
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: play,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: pause,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    configurable: true,
    value: load,
  });
  vi.stubGlobal("WebSocket", StubSocket);
});

afterEach(() => {
  play.mockClear();
  pause.mockClear();
  load.mockClear();
});

function stubConfig(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

describe("App", () => {
  test("shows the picker once /config resolves", async () => {
    stubConfig({
      offeredLanguages: ["ko", "en", "es"],
      sourceLanguage: "ko",
      transcriptDelayMs: 0,
    });

    render(<App />);

    expect(await screen.findByText("한국어")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.getByText(S.pickLanguage)).toBeTruthy();
    expect(play).not.toHaveBeenCalled();
  });

  test("picking a language starts playback and shows the listen screen", async () => {
    stubConfig({
      offeredLanguages: ["ko", "es"],
      sourceLanguage: "ko",
      transcriptDelayMs: 0,
    });

    render(<App />);
    fireEvent.click((await screen.findByText("Español")).closest("button")!);

    expect(play).toHaveBeenCalledTimes(1);
    const audio = document.querySelector("audio")!;
    expect(audio.getAttribute("src")).toMatch(/\/stream\/es\.webm\?t=\d+$/);
    expect(screen.getByText(S.silentSwitchTitle)).toBeTruthy();
    expect(screen.getByText(S.mute)).toBeTruthy();
  });

  test("mute pauses and unmute re-requests a fresh URL", async () => {
    stubConfig({
      offeredLanguages: ["ko", "es"],
      sourceLanguage: "ko",
      transcriptDelayMs: 0,
    });

    render(<App />);
    fireEvent.click((await screen.findByText("Español")).closest("button")!);
    const audio = document.querySelector("audio")!;
    const first = audio.getAttribute("src");

    fireEvent.click(screen.getByText(S.mute));
    expect(pause).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByText(S.unmute));
    expect(load).toHaveBeenCalledTimes(1);
    expect(audio.getAttribute("src")).not.toBe(first);
  });

  test("an unreachable server shows the bilingual error with a retry", async () => {
    stubConfig({}, 503);

    render(<App />);

    expect(await screen.findByText(S.configError)).toBeTruthy();
    expect(screen.getByText(S.retry)).toBeTruthy();
  });
});
