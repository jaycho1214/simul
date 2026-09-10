import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/utils/tailwind";

/*
 * Native controls, styled. shadcn's radix-mira sizes (h-7, text-xs) are
 * tuned for dense product UI; these are read on a venue laptop by someone
 * doing three other things, so they are a size up and sit on the recessed
 * surface so they read as "editable" against the card.
 */
const controlClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-inset px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(controlClass, className)} {...props} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <span className="relative block">
      <select
        data-slot="select"
        className={cn(controlClass, "appearance-none pr-9", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}
