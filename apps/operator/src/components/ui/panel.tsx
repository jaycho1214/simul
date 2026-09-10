import type { ReactNode } from "react";
import { cn } from "@/utils/tailwind";

/**
 * The one surface every panel shares. The title is deliberately quieter than
 * the data under it: the engineer knows where each panel lives after the first
 * minute, and from then on the headings are wayfinding, not content.
 */
export function Panel({
  title,
  aside,
  className,
  children,
}: {
  title: ReactNode;
  /** Sits opposite the title — a readout, a small action, a count. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-border bg-card",
        className,
      )}
    >
      <header className="flex min-h-11 items-center justify-between gap-3 px-4 pt-2.5 pb-1">
        <h2 className="text-[13px] font-semibold text-muted-foreground">{title}</h2>
        {aside}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">{children}</div>
    </section>
  );
}

/** A label above a control. */
export function Field({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-1", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** A thin rule with a small heading, separating groups inside a panel. */
export function Group({
  label,
  aside,
  children,
}: {
  label: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5 border-t border-border pt-3">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

export type NoticeTone = "warn" | "error";

/**
 * An inline message the engineer must not miss. Two tones only: amber for
 * "something to know", red for "something to fix". Neither is dismissible —
 * the condition clearing is what removes it.
 */
export function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md px-3 py-2 text-sm leading-snug",
        tone === "error" ? "bg-error/12 text-error" : "bg-warn/12 text-warn",
      )}
    >
      {children}
    </p>
  );
}
