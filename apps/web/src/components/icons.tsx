import type { SVGProps } from "react";

/**
 * The four glyphs the attendee app needs, inlined so the dependency budget
 * stays at react + react-dom. Every one is decorative — the adjacent text
 * carries the meaning — so they are hidden from assistive tech and contribute
 * nothing to `textContent`.
 */
function base(props: SVGProps<SVGSVGElement>) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...props,
  };
}

export function ChevronIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function SpeakerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

export function SpeakerOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="m22 9-6 6" />
      <path d="m16 9 6 6" />
    </svg>
  );
}

/** A bell with a slash — the glyph iOS itself shows when the switch is on. */
export function SilentSwitchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M8.7 3.5A6 6 0 0 1 18 8.5v3.2c0 .9.2 1.7.6 2.5L20 17H9" />
      <path d="M6 8.8V11.7c0 .9-.2 1.7-.6 2.5L4 17h2" />
      <path d="M10 21h4" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
