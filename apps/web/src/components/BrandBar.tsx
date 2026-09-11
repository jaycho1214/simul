import { useState, type ReactNode } from "react";
import type { Brand } from "../config.ts";
import { S } from "../strings.ts";

export interface BrandBarProps {
  brand: Brand;
  /** The channel readout and the way back, on the listen screen. */
  children?: ReactNode;
  /** Trailing controls, pinned to the far end of the bar. */
  trailing?: ReactNode;
}

/**
 * The event's identity, on both screens. On the listen screen it also carries
 * the channel chip, merged into this one bar rather than stacked above a
 * second header row — over ninety minutes the transcript is worth more than
 * the height a separate row would cost it.
 */
export function BrandBar({ brand, children, trailing }: BrandBarProps) {
  // An operator points at a file on a venue laptop that can be moved between
  // configuring it and doors opening. A broken-image glyph on sixty phones is
  // a worse outcome than no logo, so a failed load simply removes it.
  const [logoBroken, setLogoBroken] = useState(false);
  const showLogo = brand.logoUrl !== null && !logoBroken;

  return (
    <header className="brand-bar">
      <div className="brand-mark">
        {showLogo ? (
          <img
            className="brand-logo"
            src={brand.logoUrl!}
            alt=""
            onError={() => setLogoBroken(true)}
          />
        ) : null}
        <span className={brand.name ? "brand-name" : "brand-name brand-name--fallback"}>
          {brand.name ?? S.appTitle}
        </span>
      </div>
      <div className="brand-trailing">
        {children}
        {trailing}
      </div>
    </header>
  );
}
