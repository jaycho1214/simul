import type { LaneStatus } from "@tongyeok/protocol";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/ui/status-dot";
import { captureController, useCapture } from "../hooks/use-capture.ts";

/** Maps -60..0 dBFS onto 0..100 % of the bar, as the full meter does. */
function widthPercent(db: number): number {
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

/**
 * The compact always-on meter. Driven by the same rAF-plus-refs loop as the
 * full one on the 라이브 page rather than by React state: this sits in the
 * chrome of every section, and re-rendering the whole window sixty times a
 * second to move a 1.5px bar would be the most expensive thing the app does.
 */
function ToolbarLevel() {
  const coverRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const level = captureController.readLevel();
      if (coverRef.current) {
        coverRef.current.style.width = `${100 - widthPercent(level.rmsDb)}%`;
      }
      if (readoutRef.current) readoutRef.current.textContent = level.rmsDb.toFixed(1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="flex w-40 items-center gap-2.5">
      <span
        ref={readoutRef}
        className="w-10 flex-none text-right font-mono text-xs tabular-nums text-muted-foreground"
      />
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-inset">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, var(--live) 0 80%, var(--warn) 80% 90%, var(--error) 90% 100%)",
          }}
        />
        <div ref={coverRef} className="absolute inset-y-0 right-0 bg-inset" style={{ width: "100%" }} />
      </div>
    </div>
  );
}

export interface OperatorToolbarProps {
  title: string;
  lanes: LaneStatus[];
  /** The section's own action, if it has one. */
  action?: ReactNode;
}

/**
 * One line: where you are on the left, how the system is on the right.
 *
 * The live readouts sit here rather than in the rail so that navigating to a
 * setup section never takes the input level or the listener count off screen —
 * which is what makes a sidebar safe to use during a service at all. They are
 * readouts with their own labels rather than chips: an engineer reads numbers
 * off a desk, not pills.
 */
export function OperatorToolbar({ title, lanes, action }: OperatorToolbarProps) {
  const { t } = useTranslation();
  const capture = useCapture();

  const listeners = lanes.reduce((sum, lane) => sum + lane.listeners, 0);
  const errorLanes = lanes.filter((lane) => lane.state === "error").length;

  return (
    <header className="draglayer flex min-h-14 flex-none items-center justify-between gap-6 border-b border-border px-6">
      <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">{title}</h1>

      <div className="flex flex-none items-center gap-5">
        {capture.running ? (
          <ToolbarLevel />
        ) : (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <StatusDot tone="idle" />
            {t("strip.captureStopped")}
          </span>
        )}

        <div className="h-5 w-px bg-border" />

        <span className="text-sm whitespace-nowrap">
          <span className="font-mono tabular-nums">{listeners}</span>{" "}
          <span className="text-muted-foreground">{t("strip.listenersLabel")}</span>
        </span>

        {errorLanes > 0 ? (
          <span className="inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap text-error">
            <StatusDot tone="error" />
            {t("strip.errorLanes", { n: errorLanes })}
          </span>
        ) : null}

        {action}
      </div>
    </header>
  );
}
