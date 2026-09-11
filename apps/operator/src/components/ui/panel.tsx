import type { ReactNode } from "react";
import { cn } from "@/utils/tailwind";

/**
 * A block inside a section page.
 *
 * There is no card chrome here any more. In the sidebar layout the section
 * itself is the container — the rail says where you are and the page header
 * names it — so wrapping every block in a bordered, filled box drew five
 * rectangles to say something the navigation had already said. What is left
 * is a heading and its content, separated by space rather than by a border.
 *
 * `title` is optional: a page holding one block does not need to name it
 * twice.
 */
export function Panel({
  title,
  aside,
  className,
  children,
}: {
  title?: ReactNode;
  /** Sits opposite the title — a readout, a small action, a count. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col", className)}>
      {title ? (
        <header className="mb-3 flex min-h-7 items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {aside}
        </header>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-4">{children}</div>
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
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

/**
 * A row in a spec sheet: the label on the left, its control on the right, a
 * hairline between rows and none above the first — the page header already
 * draws that line, and a second one three pixels under it is noise.
 */
export function SpecRow({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] items-start gap-6 py-3.5">
      <div className="pt-1.5">
        <div className="text-sm font-medium">{label}</div>
        {hint ? (
          <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</div>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The container for a run of SpecRows. No top border on the first row. */
export function SpecRows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("max-w-3xl divide-y divide-border border-b border-border", className)}>
      {children}
    </div>
  );
}

/** A thin rule with a small heading, separating groups inside a page. */
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
    <div className="grid gap-2 border-t border-border pt-3.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
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
        "max-w-3xl rounded-lg px-3 py-2.5 text-sm leading-snug",
        tone === "error" ? "bg-error/12 text-error" : "bg-warn/12 text-warn",
      )}
    >
      {children}
    </p>
  );
}
