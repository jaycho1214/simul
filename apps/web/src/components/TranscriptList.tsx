import type { TranscriptLine } from "@tongyeok/protocol";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** How close to the bottom still counts as "following along". */
export const STICKY_THRESHOLD_PX = 48;

export function isAtBottom(metrics: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <=
    STICKY_THRESHOLD_PX
  );
}

export interface TranscriptListProps {
  lines: TranscriptLine[];
  interim: TranscriptLine | null;
  /** A node, not a string: the caller sets it as two stacked lines. */
  emptyLabel: ReactNode;
}

export function TranscriptList({
  lines,
  interim,
  emptyLabel,
}: TranscriptListProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);

  /**
   * The seqs already on screen at mount: everything the server replayed as
   * history. Anything outside this set was spoken while the reader was
   * watching and earns the commit animation. Populated once, on the first
   * render, and never added to — a line that animated must not animate again
   * on the next unrelated re-render.
   */
  const replayedRef = useRef<Set<number> | null>(null);
  if (replayedRef.current === null) {
    replayedRef.current = new Set(lines.map((line) => line.seq));
  }
  const replayed = replayedRef.current;

  // No dependency array on purpose: any content change should re-pin, and the
  // list is capped at 50 items so this is cheap.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !stuck) return;
    box.scrollTop = box.scrollHeight;
  });

  const handleScroll = () => {
    const box = boxRef.current;
    if (!box) return;
    setStuck(isAtBottom(box));
  };

  const empty = lines.length === 0 && interim === null;

  return (
    <div
      className="transcript"
      ref={boxRef}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      data-stuck={stuck}
    >
      <ol className="transcript-lines">
        {empty ? <li className="transcript-empty">{emptyLabel}</li> : null}

        {lines.map((line) => (
          <li
            key={line.seq}
            className="transcript-line"
            data-fresh={String(!replayed.has(line.seq))}
          >
            {line.text}
          </li>
        ))}

        {interim ? (
          <li
            key="interim"
            className="transcript-line transcript-line--interim"
            data-interim="true"
          >
            {interim.text}
          </li>
        ) : null}
      </ol>
    </div>
  );
}
