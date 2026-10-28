import { randomUUID } from "node:crypto";
import type {
  ChatRequest,
  ChatStreamEvent,
  Citation,
  PlatformIdentity,
  RetrievalEnv,
} from "@docs-platform/contracts";
import { getRelease, type Pool } from "@docs-platform/storage";
import { buildPrompt, type BuildPromptInput } from "./prompt.js";
import { retrieve, type RetrievedChunk } from "./retrieve.js";
import type { ChatModelClient, EmbeddingsClient, Logger, PageContext } from "./types.js";
import { noopLogger } from "./types.js";

export const DECLINE_TEXT =
  "I couldn't find anything in the documentation that answers that. Try rephrasing your question, or check the docs directly.";

/**
 * Structurally matches `ChatService` in `apps/api/src/ports.ts`. It is not imported from there:
 * packages must not depend on apps.
 */
export interface RagChatService {
  stream(input: {
    request: ChatRequest;
    identity: PlatformIdentity;
    signal: AbortSignal;
  }): AsyncIterable<ChatStreamEvent>;
}

export interface CreateChatServiceInput {
  pool: Pool;
  embeddings: EmbeddingsClient;
  chat: ChatModelClient;
  retrieval: RetrievalEnv;
  /** Configured query-embedding model (`EMBEDDINGS_MODEL`); releases built with another are refused. */
  embeddingModel: string;
  /** Configured query-embedding dimensions (`EMBEDDINGS_DIMENSIONS`). */
  embeddingDimensions: number;
  log?: Logger;
  promptLimits?: Pick<BuildPromptInput, "maxPromptChars" | "maxHistoryChars">;
}

/** Page context from a chat request: the URL's hash (if any) names the section being read. */
export function pageContextFromRequest(ctx: ChatRequest["context"]): PageContext {
  let anchor: string | undefined;
  const hash = ctx.pageUrl.indexOf("#");
  if (hash >= 0 && hash < ctx.pageUrl.length - 1) {
    try {
      anchor = decodeURIComponent(ctx.pageUrl.slice(hash + 1));
    } catch {
      anchor = ctx.pageUrl.slice(hash + 1);
    }
  }
  return { pageUrl: ctx.pageUrl, pageTitle: ctx.pageTitle, heading: ctx.heading, anchor };
}

/** Citations: only sources the answer references as `[n]`; all of them if it references none. */
export function buildCitations(answer: string, sources: RetrievedChunk[], releaseId: string): Citation[] {
  const used = new Set<number>();
  for (const m of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const n of m[1]!.split(",")) used.add(Number(n));
  }
  const toCitation = (c: RetrievedChunk, i: number): Citation => ({
    index: i + 1,
    title: c.title,
    url: c.renderedUrl + (c.anchor ? `#${c.anchor}` : ""),
    heading: c.heading ?? undefined,
    anchor: c.anchor ?? undefined,
    sourcePath: c.sourcePath,
    releaseId,
  });
  const all = sources.map(toCitation);
  const referenced = all.filter((c) => used.has(c.index));
  return referenced.length > 0 ? referenced : all;
}

class Aborted extends Error {}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Aborted());
    else signal.addEventListener("abort", () => reject(new Aborted()), { once: true });
  });
}

export function createChatService(input: CreateChatServiceInput): RagChatService {
  const log = input.log ?? noopLogger;
  // Releases are immutable, so their embedding model never changes once read.
  const compatible = new Map<string, boolean>();
  const isCompatible = async (releaseId: string): Promise<boolean> => {
    const known = compatible.get(releaseId);
    if (known !== undefined) return known;
    const release = await getRelease(input.pool, releaseId);
    // Unknown release: let retrieval run (it finds nothing); don't cache.
    if (!release) return true;
    const ok =
      release.embeddingModel === input.embeddingModel &&
      release.embeddingDimensions === input.embeddingDimensions;
    if (!ok) {
      log.warn(
        { releaseId },
        `release was embedded with ${release.embeddingModel} (${release.embeddingDimensions}d) but queries use ${input.embeddingModel} (${input.embeddingDimensions}d); rebuild the index`,
      );
    }
    compatible.set(releaseId, ok);
    return ok;
  };
  return {
    async *stream({ request, signal }) {
      const messageId = randomUUID();
      yield { type: "start", messageId };
      const aborted = abortPromise(signal);
      aborted.catch(() => undefined);
      try {
        const releaseId = request.context.releaseId;
        if (!(await Promise.race([isCompatible(releaseId), aborted]))) {
          yield {
            type: "error",
            code: "UPSTREAM_UNAVAILABLE",
            message:
              "The documentation index was built with a different embedding model; it must be rebuilt.",
          };
          return;
        }
        const pageContext = pageContextFromRequest(request.context);
        const result = await Promise.race([
          retrieve({
            pool: input.pool,
            releaseId,
            query: request.message,
            embeddings: input.embeddings,
            pageContext,
            topK: input.retrieval.RETRIEVAL_TOP_K,
            minScore: input.retrieval.RETRIEVAL_MIN_SCORE,
            pageBoost: input.retrieval.RETRIEVAL_PAGE_CONTEXT_BOOST,
            signal,
          }),
          aborted,
        ]);
        if (!result.adequate) {
          log.info({ messageId, releaseId }, "retrieval inadequate; declining without calling the model");
          yield { type: "delta", text: DECLINE_TEXT };
          yield { type: "done", status: "insufficient_context" };
          return;
        }
        const prompt = buildPrompt({
          question: request.message,
          history: request.history,
          chunks: result.chunks,
          pageContext,
          ...input.promptLimits,
        });

        let answer = "";
        const iterator = input.chat.stream(prompt.messages, signal)[Symbol.asyncIterator]();
        try {
          for (;;) {
            const next = await Promise.race([iterator.next(), aborted]);
            if (next.done) break;
            if (signal.aborted) throw new Aborted();
            answer += next.value;
            yield { type: "delta", text: next.value };
          }
        } finally {
          // Best effort; never wait on a stalled upstream.
          void Promise.resolve(iterator.return?.()).catch(() => undefined);
        }
        yield { type: "citations", sources: buildCitations(answer, prompt.sources, releaseId) };
        yield { type: "done", status: "grounded" };
      } catch (error) {
        if (signal.aborted || error instanceof Aborted) return;
        log.error({ messageId, err: error instanceof Error ? error.message : String(error) }, "chat failed");
        yield {
          type: "error",
          code: "UPSTREAM_UNAVAILABLE",
          message: "The assistant is temporarily unavailable.",
        };
      }
    },
  };
}
