// Inline SVG icons. Decorative only: the surrounding button carries the accessible name.

const svgProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

export function ChatIcon() {
  return (
    <svg {...svgProps} width={26} height={26}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...svgProps}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function ExpandIcon() {
  return (
    <svg {...svgProps}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

export function CollapseIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...svgProps}>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg {...svgProps} width={16} height={16}>
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg {...svgProps} width={16} height={16}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
