import type { ReactNode } from "react";
import { cn } from "@/utils/tailwind";

/**
 * The colour vocabulary of the whole app, in one place.
 *
 *   live   green   — carrying audio / listening / confirmed
 *   warn   amber   — in progress, and normal: starting, reconnecting, waiting
 *   error  red     — needs a hand; the only tone with visual weight
 *   idle   grey    — stopped, nothing to report
 *
 * A lane going live → reconnecting → live every ten minutes is routine, so
 * "warn" must never look like an alarm — it breathes, it does not flash.
 */
export type Tone = "live" | "warn" | "error" | "idle";

const DOT: Record<Tone, string> = {
  live: "bg-live shadow-[0_0_0_3px_color-mix(in_oklab,var(--live)_22%,transparent)]",
  warn: "bg-warn breathe",
  error: "bg-error",
  idle: "bg-muted-foreground/40",
};

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", DOT[tone], className)}
    />
  );
}

/** A dot with its words. */
export function StatusLine({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <StatusDot tone={tone} />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

const CHIP: Record<Tone, string> = {
  live: "border-live/30 text-foreground",
  warn: "border-warn/40 text-foreground",
  error: "border-error/60 bg-error/15 text-error font-semibold",
  idle: "border-border text-muted-foreground",
};

/**
 * A pill for the header strip: what the engineer sees in peripheral vision.
 * Only the error tone is filled, so a red pill appearing is itself the signal.
 */
export function StatusChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium",
        CHIP[tone],
      )}
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}
