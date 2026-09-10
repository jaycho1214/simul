import type { TranscriptLine } from "@tongyeok/protocol";
import { useLayoutEffect, useRef, useState } from "react";

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
  emptyLabel: string;
}

export function TranscriptList({
  lines,
  interim,
  emptyLabel,
}: TranscriptListProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);

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
          <li key={line.seq} className="transcript-line">
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
