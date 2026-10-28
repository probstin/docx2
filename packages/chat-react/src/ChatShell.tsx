import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChatConversation } from "./ChatConversation.js";
import { ChatHeader } from "./ChatHeader.js";
import { ChatLauncher } from "./ChatLauncher.js";
import { trapTabKey } from "./focus.js";
import type { ChatMode, PageContextInfo, UiMessage } from "./types.js";

export interface ChatShellProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  messages: UiMessage[];
  isStreaming: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  onRetry?: (messageId: string) => void;
  onClear?: () => void;
  title: string;
  welcomeMessage: string;
  pageContext?: PageContextInfo;
  /** When false, the header has no fullscreen toggle. */
  expandable: boolean;
  suggestions?: string[];
}

/**
 * Top-level controlled chat UI. Renders the launcher when closed, a floating panel in
 * "panel" mode, and a full-viewport modal dialog in "fullscreen" mode. Both open modes
 * render the same conversation subtree; the unsent draft lives here so it survives a
 * mode switch (the message list comes from props, so it does too).
 */
export function ChatShell({
  mode,
  onModeChange,
  messages,
  isStreaming,
  onSend,
  onCancel,
  onRetry,
  onClear,
  title,
  welcomeMessage,
  pageContext,
  expandable,
  suggestions,
}: ChatShellProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");

  // Escape steps back: fullscreen -> panel, panel -> closed.
  useEffect(() => {
    if (mode === "closed") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      onModeChange(mode === "fullscreen" ? "panel" : "closed");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mode, onModeChange]);

  // Move focus on mode transitions. Selectors are scoped to our root element.
  const previousModeRef = useRef(mode);
  useEffect(() => {
    const previous = previousModeRef.current;
    previousModeRef.current = mode;
    if (previous === mode) return;
    const root = rootRef.current;
    if (!root) return;
    if (mode === "closed") {
      root.querySelector<HTMLElement>("[data-dp-chat-launcher]")?.focus();
    } else if (mode === "panel" && previous === "fullscreen") {
      // Return focus to the control that opened fullscreen.
      root.querySelector<HTMLElement>("[data-dp-chat-expand]")?.focus();
    } else {
      root.querySelector<HTMLElement>("textarea")?.focus();
    }
  }, [mode]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    trapTabKey(event, event.currentTarget);
  };

  const body = (
    <>
      <ChatHeader
        title={title}
        titleId={titleId}
        mode={mode === "fullscreen" ? "fullscreen" : "panel"}
        expandable={expandable}
        onToggleExpand={() => onModeChange(mode === "fullscreen" ? "panel" : "fullscreen")}
        onClear={onClear}
        onClose={() => onModeChange("closed")}
      />
      <ChatConversation
        messages={messages}
        isStreaming={isStreaming}
        draft={draft}
        onDraftChange={setDraft}
        onSend={onSend}
        onCancel={onCancel}
        onRetry={onRetry}
        welcomeMessage={welcomeMessage}
        suggestions={suggestions}
        pageContext={pageContext}
      />
    </>
  );

  return (
    <div ref={rootRef} className="dp-chat-root" data-mode={mode}>
      {mode === "closed" ? (
        <ChatLauncher label={`Open ${title}`} onOpen={() => onModeChange("panel")} />
      ) : null}
      {mode === "panel" ? (
        <section className="dp-chat-panel" aria-labelledby={titleId}>
          {body}
        </section>
      ) : null}
      {mode === "fullscreen" ? (
        <div
          className="dp-chat-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={handleDialogKeyDown}
        >
          {body}
        </div>
      ) : null}
    </div>
  );
}
