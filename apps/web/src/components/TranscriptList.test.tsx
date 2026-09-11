import type { TranscriptLine } from "@tongyeok/protocol";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { STICKY_THRESHOLD_PX, TranscriptList, isAtBottom } from "./TranscriptList.tsx";

function line(seq: number, text: string, isFinal = true): TranscriptLine {
  return { seq, text, isFinal, ts: seq };
}

/** jsdom does no layout, so the metrics the pin depends on are set by hand. */
function size(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
}

describe("isAtBottom", () => {
  test("is true at the bottom and within the threshold", () => {
    expect(isAtBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(
      isAtBottom({
        scrollTop: 600 - STICKY_THRESHOLD_PX,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(true);
  });

  test("is false once the reader has scrolled up past the threshold", () => {
    expect(isAtBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });
});

describe("TranscriptList", () => {
  test("renders one item per line, newest last", () => {
    render(
      <TranscriptList
        lines={[line(1, "첫 줄"), line(2, "second"), line(3, "third")]}
        interim={null}
        emptyLabel="empty"
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items.map((el) => el.textContent)).toEqual(["첫 줄", "second", "third"]);
  });

  test("the interim line renders last and is marked as interim", () => {
    render(
      <TranscriptList
        lines={[line(1, "committed")]}
        interim={line(2, "in progress", false)}
        emptyLabel="empty"
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items.at(-1)!.textContent).toBe("in progress");
    expect(items.at(-1)!.getAttribute("data-interim")).toBe("true");
    expect(items[0]!.getAttribute("data-interim")).toBeNull();
  });

  test("shows the empty label until anything arrives", () => {
    render(<TranscriptList lines={[]} interim={null} emptyLabel="말씀을 기다리는 중 / Waiting" />);
    expect(screen.getByText("말씀을 기다리는 중 / Waiting")).toBeTruthy();
  });

  test("appending a line pins the view to the bottom", () => {
    const { rerender } = render(
      <TranscriptList lines={[line(1, "a")]} interim={null} emptyLabel="empty" />,
    );
    const box = screen.getByRole("log");
    size(box, 1000, 400);

    rerender(
      <TranscriptList lines={[line(1, "a"), line(2, "b")]} interim={null} emptyLabel="empty" />,
    );

    expect(box.scrollTop).toBe(1000);
    expect(box.getAttribute("data-stuck")).toBe("true");
  });

  test("scrolling up releases the pin", () => {
    const { rerender } = render(
      <TranscriptList lines={[line(1, "a")]} interim={null} emptyLabel="empty" />,
    );
    const box = screen.getByRole("log");
    size(box, 1000, 400);

    box.scrollTop = 100;
    fireEvent.scroll(box);
    expect(box.getAttribute("data-stuck")).toBe("false");

    rerender(
      <TranscriptList lines={[line(1, "a"), line(2, "b")]} interim={null} emptyLabel="empty" />,
    );

    expect(box.scrollTop).toBe(100);
  });

  test("scrolling back to the bottom re-pins", () => {
    const { rerender } = render(
      <TranscriptList lines={[line(1, "a")]} interim={null} emptyLabel="empty" />,
    );
    const box = screen.getByRole("log");
    size(box, 1000, 400);

    box.scrollTop = 100;
    fireEvent.scroll(box);
    box.scrollTop = 600;
    fireEvent.scroll(box);
    expect(box.getAttribute("data-stuck")).toBe("true");

    rerender(
      <TranscriptList lines={[line(1, "a"), line(2, "b")]} interim={null} emptyLabel="empty" />,
    );

    expect(box.scrollTop).toBe(1000);
  });
});

/**
 * The commit animation is the app's one deliberate motion, and it only means
 * something for a line that arrives while you are watching. On connect the
 * server replays up to fifty lines of history at once; animating those would
 * turn the single meaningful moment into a stampede.
 */
describe("the commit animation", () => {
  const line = (seq: number, text: string) => ({
    seq,
    text,
    ts: seq,
    isFinal: true,
  });

  test("does not mark replayed history as fresh", () => {
    render(
      <TranscriptList
        lines={[line(1, "first"), line(2, "second")]}
        interim={null}
        emptyLabel="empty"
      />,
    );
    for (const el of screen.getAllByRole("listitem")) {
      expect(el.getAttribute("data-fresh")).toBe("false");
    }
  });

  test("marks a line that arrives after mount as fresh", () => {
    const { rerender } = render(
      <TranscriptList lines={[line(1, "first")]} interim={null} emptyLabel="empty" />,
    );
    rerender(
      <TranscriptList
        lines={[line(1, "first"), line(2, "second")]}
        interim={null}
        emptyLabel="empty"
      />,
    );

    expect(screen.getByText("first").getAttribute("data-fresh")).toBe("false");
    expect(screen.getByText("second").getAttribute("data-fresh")).toBe("true");
  });

  test("keeps a line fresh across an unrelated re-render", () => {
    const { rerender } = render(<TranscriptList lines={[]} interim={null} emptyLabel="empty" />);
    rerender(<TranscriptList lines={[line(9, "spoken")]} interim={null} emptyLabel="empty" />);
    rerender(
      <TranscriptList
        lines={[line(9, "spoken")]}
        interim={{ seq: 10, text: "half", ts: 10, isFinal: false }}
        emptyLabel="empty"
      />,
    );

    expect(screen.getByText("spoken").getAttribute("data-fresh")).toBe("true");
  });
});
