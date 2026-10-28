import { useEffect, useRef, useState } from "react";
import { copyText } from "./clipboard.js";

/** How long the "Copied" confirmation stays visible. */
export const COPIED_FEEDBACK_MS = 2000;

export interface CopyButtonProps {
  /** Exact text written to the clipboard. */
  text: string;
  /** Accessible name while idle, e.g. "Copy code". */
  label: string;
  /** Accessible name and visible text after a successful copy. */
  copiedLabel?: string;
  className: string;
  /** Shows a "Copy" / copied text next to the icon. */
  showText?: boolean;
}

function CopyGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function CopyButton({
  text,
  label,
  copiedLabel = "Copied",
  className,
  showText = false,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const handleClick = async () => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };

  return (
    <button
      type="button"
      className={`dp-chat-copy-button ${className}`}
      aria-label={copied ? copiedLabel : label}
      title={copied ? copiedLabel : label}
      onClick={handleClick}
    >
      {copied ? <CheckGlyph /> : <CopyGlyph />}
      {showText ? <span>{copied ? copiedLabel : "Copy"}</span> : null}
    </button>
  );
}
