import { useId, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { SendIcon, StopIcon } from "./icons.js";

/** Mirrors `CHAT_LIMITS.messageMaxChars` in @docs-platform/contracts (type-only import keeps zod out of the bundle). */
export const MESSAGE_MAX_CHARS = 4000;
const COUNTER_THRESHOLD = Math.floor(MESSAGE_MAX_CHARS * 0.8);
const MAX_ROWS = 6;

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Called with the trimmed text. Never called while `isStreaming` or when the text is blank. */
  onSend: (text: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
}

/** Grows the textarea with its content, up to MAX_ROWS lines. */
function autosize(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  const style = getComputedStyle(element);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 21;
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const maxHeight = lineHeight * MAX_ROWS + padding;
  element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
  element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
}

export function Composer({ value, onChange, onSend, onCancel, isStreaming }: ComposerProps) {
  const textareaId = useId();
  const hintId = useId();
  const counterId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !isStreaming;
  const showCounter = value.length >= COUNTER_THRESHOLD;

  useLayoutEffect(() => {
    autosize(textareaRef.current);
  }, [value]);

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline; IME composition (keyCode 229) never sends.
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  };

  return (
    <form
      className="dp-chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={textareaId} className="dp-chat-sr-only">
        Ask a question about the documentation
      </label>
      <textarea
        ref={textareaRef}
        id={textareaId}
        className="dp-chat-textarea"
        rows={1}
        value={value}
        maxLength={MESSAGE_MAX_CHARS}
        placeholder="Ask a question…"
        aria-describedby={showCounter ? `${hintId} ${counterId}` : hintId}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span id={hintId} className="dp-chat-sr-only">
        Press Enter to send, Shift+Enter for a new line.
      </span>
      <div className="dp-chat-composer-actions">
        {showCounter ? (
          <span
            id={counterId}
            className={`dp-chat-counter${value.length >= MESSAGE_MAX_CHARS ? " dp-chat-counter-full" : ""}`}
          >
            {value.length}/{MESSAGE_MAX_CHARS}
          </span>
        ) : null}
        {isStreaming ? (
          <button type="button" className="dp-chat-button dp-chat-button-stop" onClick={onCancel}>
            <StopIcon />
            <span>Stop</span>
          </button>
        ) : (
          <button type="submit" className="dp-chat-button dp-chat-button-primary" disabled={!canSend}>
            <span>Send</span>
            <SendIcon />
          </button>
        )}
      </div>
    </form>
  );
}
