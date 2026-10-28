import { useEffect, useRef } from "react";
import { Composer } from "./Composer.js";
import { EmptyState } from "./EmptyState.js";
import { MessageBubble } from "./MessageBubble.js";
import { PageContextChip } from "./PageContextChip.js";
import type { PageContextInfo, UiMessage } from "./types.js";

/** Distance from the bottom (px) within which the list still counts as "following" the stream. */
const PIN_THRESHOLD_PX = 32;

export interface ChatConversationProps {
  messages: UiMessage[];
  isStreaming: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (text: string) => void;
  onCancel: () => void;
  onRetry?: (messageId: string) => void;
  welcomeMessage: string;
  suggestions?: string[];
  pageContext?: PageContextInfo;
}

export function ChatConversation({
  messages,
  isStreaming,
  draft,
  onDraftChange,
  onSend,
  onCancel,
  onRetry,
  welcomeMessage,
  suggestions,
  pageContext,
}: ChatConversationProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // True while the user is at (or has deliberately returned to) the bottom of the list.
  const pinnedRef = useRef(true);
  const lastCountRef = useRef(messages.length);

  useEffect(() => {
    const list = listRef.current;
    const count = messages.length;
    // A newly sent user message always brings the view down to the new exchange.
    const last = messages[count - 1];
    if (count > lastCountRef.current && last?.role === "user") pinnedRef.current = true;
    lastCountRef.current = count;
    if (list && pinnedRef.current) list.scrollTop = list.scrollHeight;
  }, [messages, isStreaming]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    pinnedRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= PIN_THRESHOLD_PX;
  };

  return (
    <div className="dp-chat-conversation">
      <div ref={listRef} className="dp-chat-messages" role="log" aria-live="polite" onScroll={handleScroll}>
        {messages.length === 0 ? (
          <EmptyState welcomeMessage={welcomeMessage} suggestions={suggestions} onSuggestion={onSend} />
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} onRetry={onRetry} />)
        )}
      </div>
      <div className="dp-chat-footer">
        {pageContext ? <PageContextChip pageContext={pageContext} /> : null}
        <Composer
          value={draft}
          onChange={onDraftChange}
          isStreaming={isStreaming}
          onCancel={onCancel}
          onSend={(text) => {
            onSend(text);
            onDraftChange("");
          }}
        />
      </div>
    </div>
  );
}
