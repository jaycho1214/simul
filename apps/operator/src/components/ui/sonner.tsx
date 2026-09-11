import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * sonner styled with the app's own tokens. The window is one dark mode
 * (global.css), so the theme is fixed rather than following the OS.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      closeButton
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          description: "!text-muted-foreground",
          actionButton: "!bg-live !text-[oklch(0.2_0.03_155)] !font-semibold",
        },
      }}
      {...props}
    />
  );
}
