import { useCallback } from "react";
import { ChatShell } from "./ChatShell.js";
import type { PageContextInfo } from "./types.js";
import { useChat } from "./useChat.js";
import { useChatMode } from "./useChatMode.js";

export interface ChatWidgetProps {
  endpoint: string;
  releaseId: string;
  title: string;
  welcomeMessage: string;
  expandable: boolean;
  pageContextEnabled: boolean;
  getPageContext: () => PageContextInfo;
  suggestions?: string[];
  /** sessionStorage key; include the site basePath so sites don't share state. */
  storageKey: string;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

/** Drop-in assistant: wires chat state, streaming and persisted mode into `ChatShell`. */
export function ChatWidget({
  endpoint,
  releaseId,
  title,
  welcomeMessage,
  expandable,
  pageContextEnabled,
  getPageContext,
  suggestions,
  storageKey,
  fetchImpl,
}: ChatWidgetProps) {
  const [mode, setMode] = useChatMode(storageKey);

  // The contract requires pageUrl; title/heading are only sent when page context is on.
  const requestContext = useCallback((): PageContextInfo => {
    const page = getPageContext();
    return pageContextEnabled ? page : { url: page.url };
  }, [getPageContext, pageContextEnabled]);

  const chat = useChat({
    endpoint,
    releaseId,
    getPageContext: requestContext,
    storageKey,
    ...(fetchImpl ? { fetchImpl } : {}),
  });

  return (
    <ChatShell
      mode={mode}
      onModeChange={setMode}
      messages={chat.messages}
      isStreaming={chat.isStreaming}
      onSend={chat.send}
      onCancel={chat.cancel}
      onRetry={chat.retry}
      onClear={chat.clear}
      title={title}
      welcomeMessage={welcomeMessage}
      expandable={expandable}
      {...(suggestions ? { suggestions } : {})}
      {...(pageContextEnabled && mode !== "closed" ? { pageContext: getPageContext() } : {})}
    />
  );
}
