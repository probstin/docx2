import { z } from "zod";
import { ReleaseIdSchema } from "./lifecycle.js";

export const CHAT_LIMITS = {
  messageMaxChars: 4000,
  historyMaxMessages: 20,
  historyMessageMaxChars: 8000,
} as const;

export const ChatHistoryMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(CHAT_LIMITS.historyMessageMaxChars),
});

/**
 * Conversation state lives in the browser (MVP has no server-side history), so the
 * client sends the recent window; the server bounds it again before prompting.
 */
export const ChatRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(CHAT_LIMITS.messageMaxChars),
  conversationId: z.string().min(1).max(128).optional(),
  history: z.array(ChatHistoryMessageSchema).max(CHAT_LIMITS.historyMaxMessages).default([]),
  context: z.strictObject({
    releaseId: ReleaseIdSchema,
    pageUrl: z.string().min(1).max(2048),
    pageTitle: z.string().max(300).optional(),
    heading: z.string().max(300).optional(),
  }),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatRequestInput = z.input<typeof ChatRequestSchema>;
export type ChatHistoryMessage = z.infer<typeof ChatHistoryMessageSchema>;

export const CitationSchema = z.object({
  /** 1-based marker the answer text may reference as `[1]`. */
  index: z.number().int().positive(),
  title: z.string(),
  /** Site route including anchor, e.g. `/docs/guides/deployment#rollback`. */
  url: z.string(),
  heading: z.string().optional(),
  anchor: z.string().optional(),
  sourcePath: z.string(),
  releaseId: ReleaseIdSchema,
});

export type Citation = z.infer<typeof CitationSchema>;

export const ChatAnswerStatusSchema = z.enum([
  /** Answer is supported by retrieved documentation. */
  "grounded",
  /** Retrieval was inadequate; the answer declines rather than inventing details. */
  "insufficient_context",
]);

export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), messageId: z.string() }),
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("citations"), sources: z.array(CitationSchema) }),
  z.object({ type: z.literal("done"), status: ChatAnswerStatusSchema }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);

export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
export type ChatAnswerStatus = z.infer<typeof ChatAnswerStatusSchema>;
