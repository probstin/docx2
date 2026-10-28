import type { ChatAnswerStatus, Citation } from "@docs-platform/contracts";

export type UiMessageStatus = "streaming" | "complete" | "error" | "cancelled";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: UiMessageStatus;
  citations?: Citation[];
  answerStatus?: ChatAnswerStatus;
  errorMessage?: string;
}

export interface PageContextInfo {
  title?: string;
  heading?: string;
  url: string;
}

export type ChatMode = "closed" | "panel" | "fullscreen";
