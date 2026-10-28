/**
 * TEMPORARY STUB for `ChatWidget` from `@docs-platform/chat-react`.
 *
 * Same props as the real widget; renders the presentational `ChatShell` with no-op handlers so the
 * launcher and panel are visible but nothing is sent.
 *
 * SWAP: in `Root.tsx`, change the single import line
 *   import { ChatWidget } from "./chat-widget-stub";
 * to
 *   import { ChatWidget } from "@docs-platform/chat-react";
 * then delete this file.
 */
import { useState } from "react";
import { ChatShell, type ChatMode } from "@docs-platform/chat-react";

export interface ChatWidgetProps {
  endpoint: string;
  releaseId: string;
  title: string;
  welcomeMessage: string;
  expandable: boolean;
  pageContextEnabled: boolean;
  getPageContext: () => { url: string; title?: string; heading?: string };
  suggestions?: string[];
  storageKey: string;
}

export function ChatWidget(props: ChatWidgetProps) {
  const [mode, setMode] = useState<ChatMode>("closed");
  return (
    <ChatShell
      mode={mode}
      onModeChange={setMode}
      messages={[]}
      isStreaming={false}
      onSend={() => {}}
      onCancel={() => {}}
      title={props.title}
      welcomeMessage={props.welcomeMessage}
      expandable={props.expandable}
      suggestions={props.suggestions}
      pageContext={props.pageContextEnabled ? props.getPageContext() : undefined}
    />
  );
}
