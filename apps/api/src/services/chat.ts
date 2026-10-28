import type { ChatService } from "../ports.js";

/**
 * ChatService wiring point.
 *
 * `main.ts` passes the implementation through `provideChatService`. To go live, replace the
 * placeholder argument there with `createChatService({ pool, embeddings, chat, retrieval, log })`
 * from `@docs-platform/rag`. Nothing else in the API changes.
 */
export function provideChatService(impl: ChatService): ChatService {
  return impl;
}

/** Temporary stand-in until `@docs-platform/rag` is integrated. */
export const placeholderChatService: ChatService = {
  async *stream() {
    yield { type: "start", messageId: "placeholder" };
    yield { type: "error", code: "UPSTREAM_UNAVAILABLE", message: "chat not wired" };
  },
};
