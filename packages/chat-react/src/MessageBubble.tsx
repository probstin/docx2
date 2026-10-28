import { CitationList } from "./CitationList.js";
import { MessageContent } from "./MessageContent.js";
import { CopyButton } from "./markdown/CopyButton.js";
import type { UiMessage } from "./types.js";

export interface MessageBubbleProps {
  message: UiMessage;
  onRetry?: (messageId: string) => void;
}

function TypingIndicator() {
  return (
    <div className="dp-chat-typing">
      <span className="dp-chat-sr-only">Generating answer</span>
      <span className="dp-chat-typing-dot" aria-hidden="true" />
      <span className="dp-chat-typing-dot" aria-hidden="true" />
      <span className="dp-chat-typing-dot" aria-hidden="true" />
    </div>
  );
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const { role, status, content, citations, answerStatus, errorMessage } = message;
  const isStreaming = status === "streaming";
  const showTyping = isStreaming && content.length === 0;
  const label = role === "user" ? "You" : "Assistant";

  return (
    <article
      className={`dp-chat-message dp-chat-message-${role} dp-chat-message-${status}`}
      aria-label={label}
      aria-busy={isStreaming || undefined}
    >
      {showTyping ? (
        <TypingIndicator />
      ) : (
        <>
          <MessageContent text={content} citations={citations} plain={role === "user"} />
          {isStreaming ? <span className="dp-chat-caret" aria-hidden="true" /> : null}
        </>
      )}

      {role === "assistant" && status === "complete" && content.length > 0 ? (
        <div className="dp-chat-message-actions">
          <CopyButton text={content} label="Copy answer" className="dp-chat-copy-answer" />
        </div>
      ) : null}

      {answerStatus === "insufficient_context" ? (
        <p className="dp-chat-notice">Not found in the documentation</p>
      ) : null}

      {status === "cancelled" ? <p className="dp-chat-note">Stopped</p> : null}

      {status === "error" ? (
        <div className="dp-chat-error" role="alert">
          <p className="dp-chat-error-text">{errorMessage ?? "Something went wrong. Please try again."}</p>
          {onRetry ? (
            <button
              type="button"
              className="dp-chat-button dp-chat-button-secondary"
              onClick={() => onRetry(message.id)}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {citations && citations.length > 0 ? <CitationList citations={citations} /> : null}
    </article>
  );
}
