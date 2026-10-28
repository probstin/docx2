import type { PageContextInfo } from "./types.js";

export interface PageContextChipProps {
  pageContext: PageContextInfo;
}

/** "Asking about: <title › heading>", falling back to the page URL when no title is known. */
export function PageContextChip({ pageContext }: PageContextChipProps) {
  const parts = [pageContext.title, pageContext.heading].filter((part): part is string => Boolean(part));
  const label = parts.length > 0 ? parts.join(" › ") : pageContext.url;
  return (
    <p className="dp-chat-context-chip">
      <span className="dp-chat-context-label">Asking about:</span>{" "}
      <span className="dp-chat-context-value">{label}</span>
    </p>
  );
}
