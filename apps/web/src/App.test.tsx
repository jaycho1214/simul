import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App.tsx";
import { S, bilingual } from "./strings.ts";

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
      live: true,
      transcriptDelayMs: 0,
    });

    render(<App />);

    expect(await screen.findByText("한국어")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.getByText(bilingual(S.pickLanguage).ko)).toBeTruthy();
    expect(play).not.toHaveBeenCalled();
  });

  test("picking a language starts playback and shows the listen screen", async () => {
    stubConfig({
      offeredLanguages: ["ko", "es"],
      live: true,
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
      live: true,
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

    // Both halves, each on its own line — the point of the test's name is that
    // a reader of either language can read it.
    expect(await screen.findByText(bilingual(S.configError).ko)).toBeTruthy();
    expect(screen.getByText(bilingual(S.configError).en)).toBeTruthy();
    expect(screen.getByText(S.retry)).toBeTruthy();
  });
});

/**
 * Picking a language is a navigation as far as the reader is concerned, so the
 * phone's own back gesture has to honour it. Without a history entry an iOS
 * edge-swipe leaves the app entirely — off the venue's page, mid-service, with
 * no obvious way back other than re-scanning the QR code.
 */
describe("the back gesture", () => {
  test("returns to the picker instead of leaving the page", async () => {
    stubConfig({
      offeredLanguages: ["ko", "en", "es"],
      live: true,
      transcriptDelayMs: 0,
    });
    render(<App />);

    fireEvent.click(await screen.findByText("English"));
    expect(screen.queryByText(bilingual(S.pickLanguage).ko)).toBeNull();

    // What Safari dispatches when the reader swipes from the left edge.
    fireEvent.popState(window);

    expect(await screen.findByText(bilingual(S.pickLanguage).ko)).toBeTruthy();
  });

  test("pushes exactly one entry, so one swipe is enough", async () => {
    stubConfig({
      offeredLanguages: ["ko", "en", "es"],
      live: true,
      transcriptDelayMs: 0,
    });
    const pushSpy = vi.spyOn(window.history, "pushState");
    render(<App />);

    fireEvent.click(await screen.findByText("English"));

    expect(pushSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * The moment the operator presses 시작, a hall full of phones already sitting
 * on the picker has to come alive on its own. Nobody is going to think to
 * pull-to-refresh, and an app that must be reloaded to become usable is one
 * the ushers spend the first ten minutes explaining.
 */
test("wakes the picker up when the room goes live, without a reload", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const room = {
    offeredLanguages: ["ko", "en"],
    passthroughLanguage: null,
    transcriptDelayMs: 0,
    streamPrimeMs: 0,
  };
  let live = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ...room, live }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );

  render(<App />);
  const row = (await screen.findByText("English")).closest("button")!;
  expect(row.hasAttribute("disabled")).toBe(true);

  live = true;
  await vi.advanceTimersByTimeAsync(4000);

  await waitFor(() =>
    expect(
      screen.getByText("English").closest("button")!.hasAttribute("disabled"),
    ).toBe(false),
  );
  vi.useRealTimers();
});
