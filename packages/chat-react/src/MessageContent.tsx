import { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation } from "@docs-platform/contracts";
import { markdownComponents } from "./markdown/components.js";
import { remarkCitationLinks } from "./markdown/citations.js";

export interface MessageContentProps {
  text: string;
  /** Citations for this message. `[n]` markers in the text link to the citation with index `n`. */
  citations?: Citation[];
  /** Shows the text verbatim, without Markdown. Used for user messages. */
  plain?: boolean;
}

/**
 * Renders message text. Assistant answers are Markdown without raw HTML: react-markdown escapes
 * HTML by default and this component never enables rehype-raw. Partial Markdown (an unclosed
 * code fence while streaming) renders as far as it goes.
 */
export function MessageContent({ text, citations, plain = false }: MessageContentProps) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkCitationLinks(citations)], [citations]);

  if (plain) {
    return <div className="dp-chat-message-content dp-chat-plain">{text}</div>;
  }

  return (
    <div className="dp-chat-message-content dp-chat-markdown">
      <Markdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {text}
      </Markdown>
    </div>
  );
}
