import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useListenSession } from "./use-listen-session.ts";

class StubSocket {
  static instances: StubSocket[] = [];

  readyState = 0;
  closed = false;
  private readonly handlers = new Map<string, Set<(event: Event) => void>>();

  constructor(readonly url: string) {
    StubSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(listener);
    this.handlers.set(type, set);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.dispatch("open", new Event("open"));
  }

  deliver(message: unknown): void {
    const event = new Event("message") as Event & { data?: string };
    event.data = JSON.stringify(message);
    this.dispatch("message", event);
  }

  private dispatch(type: string, event: Event): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(event);
  }
}

function Probe({ transcriptDelayMs }: { transcriptDelayMs: number }) {
  const { state } = useListenSession({
    lang: "es",
    wsBaseUrl: "ws://host",
    transcriptDelayMs,
  });
  return (
    <div>
      <span data-testid="lines">{state.lines.map((l) => l.text).join("|")}</span>
      <span data-testid="lane">{state.laneState}</span>
    </div>
  );
}

function line(seq: number, text: string) {
  return { seq, text, isFinal: true, ts: seq };
}

afterEach(() => {
  vi.useRealTimers();
  StubSocket.instances = [];
});

describe("useListenSession", () => {
  test("renders history immediately and holds live lines for the delay", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", StubSocket);
    render(<Probe transcriptDelayMs={1500} />);

    const socket = StubSocket.instances[0]!;
    act(() => {
      socket.open();
      socket.deliver({ type: "hello", lang: "es", historyLines: 1 });
      socket.deliver({ type: "history", lines: [line(1, "old")] });
      socket.deliver({ type: "lane", state: "live" });
    });

    expect(screen.getByTestId("lines").textContent).toBe("old");
    expect(screen.getByTestId("lane").textContent).toBe("live");

    act(() => {
      socket.deliver({ type: "transcript", line: line(2, "nuevo") });
    });
    expect(screen.getByTestId("lines").textContent).toBe("old");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId("lines").textContent).toBe("old|nuevo");
  });

  test("a replayed history discards lines still waiting out the delay", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", StubSocket);
    render(<Probe transcriptDelayMs={1500} />);

    const socket = StubSocket.instances[0]!;
    act(() => {
      socket.open();
      socket.deliver({ type: "transcript", line: line(2, "stale") });
      socket.deliver({ type: "history", lines: [line(1, "a"), line(2, "stale")] });
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByTestId("lines").textContent).toBe("a|stale");
  });

  test("unmounting stops the client", () => {
    vi.stubGlobal("WebSocket", StubSocket);
    const { unmount } = render(<Probe transcriptDelayMs={0} />);

    unmount();

    expect(StubSocket.instances.every((s) => s.closed)).toBe(true);
  });
});
