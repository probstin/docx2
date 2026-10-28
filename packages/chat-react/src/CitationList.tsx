import type { Citation } from "@docs-platform/contracts";
import { isSafeHref } from "./focus.js";

export interface CitationListProps {
  citations: Citation[];
}

/** Path portion of a site route, e.g. `/docs/guides/deployment#rollback` (no origin). */
function displayPath(url: string): string {
  try {
    const parsed = new URL(url, "http://placeholder.invalid");
    return `${parsed.pathname}${parsed.hash}`;
  } catch {
    return url;
  }
}

export function CitationList({ citations }: CitationListProps) {
  if (citations.length === 0) return null;
  return (
    <nav className="dp-chat-citations" aria-label="Sources">
      <ol className="dp-chat-citation-list">
        {citations.map((citation) => {
          const label = citation.heading ? `${citation.title} › ${citation.heading}` : citation.title;
          const path = displayPath(citation.url);
          return (
            <li key={`${citation.index}-${citation.url}`} value={citation.index} className="dp-chat-citation">
              {isSafeHref(citation.url) ? (
                <a href={citation.url} className="dp-chat-citation-link">
                  <span className="dp-chat-citation-label">{label}</span>
                  <span className="dp-chat-citation-path">{path}</span>
                </a>
              ) : (
                <span className="dp-chat-citation-label">{label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
