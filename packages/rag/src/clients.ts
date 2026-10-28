import type { ModelsEnv } from "@docs-platform/contracts";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import type { ChatMessage, ChatModelClient, EmbeddingsClient } from "./types.js";

export class EmbeddingDimensionError extends Error {
  constructor(expected: number, actual: number, model?: string) {
    super(
      `Embeddings endpoint${model ? ` (model ${model})` : ""} returned a vector with ${actual} dimensions, ` +
        `but EMBEDDINGS_DIMENSIONS is ${expected}. Fix EMBEDDINGS_DIMENSIONS or the model.`,
    );
    this.name = "EmbeddingDimensionError";
  }
}

export function assertVectors(
  vectors: number[][],
  expectedCount: number,
  dims: number,
  model?: string,
): void {
  if (vectors.length !== expectedCount) {
    throw new Error(`Embeddings endpoint returned ${vectors.length} vectors for ${expectedCount} inputs`);
  }
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== dims)
      throw new EmbeddingDimensionError(dims, v?.length ?? 0, model);
    if (!v.every(Number.isFinite)) throw new Error("Embeddings endpoint returned non-finite values");
  }
}

export interface EmbeddingsOptions {
  /** Texts per request (default 64). */
  batchSize?: number;
  /** Concurrent requests (default 4). */
  concurrency?: number;
  /**
   * Send the `dimensions` parameter to the endpoint. Off by default: many internal servers reject it.
   * Only for OpenAI-style models that support truncation.
   */
  sendDimensions?: boolean;
  /** Per-request timeout in ms (default 60000). */
  timeoutMs?: number;
}

/** The subset of LangChain's embeddings API we use; lets tests substitute a fake. */
export interface LangChainEmbeddingsLike {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

/** Wraps any LangChain-style embedder with batching, bounded concurrency and dimension validation. */
export function wrapEmbeddings(
  inner: LangChainEmbeddingsLike,
  dims: number,
  options: EmbeddingsOptions = {},
  model?: string,
): EmbeddingsClient {
  const batchSize = Math.max(1, options.batchSize ?? 64);
  const concurrency = Math.max(1, options.concurrency ?? 4);
  return {
    async embedDocuments(texts, signal) {
      const batches: string[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) batches.push(texts.slice(i, i + batchSize));
      const results: number[][][] = new Array(batches.length);
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < batches.length) {
          signal?.throwIfAborted();
          const i = next++;
          const batch = batches[i]!;
          const vectors = await inner.embedDocuments(batch);
          assertVectors(vectors, batch.length, dims, model);
          results[i] = vectors;
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
      signal?.throwIfAborted();
      return results.flat();
    },
    async embedQuery(text, signal) {
      signal?.throwIfAborted();
      const v = await inner.embedQuery(text);
      assertVectors([v], 1, dims, model);
      return v;
    },
  };
}

/** Placeholder for keyless internal endpoints; the OpenAI SDK refuses an empty key. */
const NO_KEY = "not-needed";

export function createEmbeddingsClient(env: ModelsEnv, options: EmbeddingsOptions = {}): EmbeddingsClient {
  const batchSize = options.batchSize ?? 64;
  const lc = new OpenAIEmbeddings({
    model: env.EMBEDDINGS_MODEL,
    apiKey: env.EMBEDDINGS_API_KEY || NO_KEY,
    configuration: { baseURL: env.EMBEDDINGS_BASE_URL },
    // We batch ourselves; keep LangChain from re-splitting or rewriting inputs.
    batchSize,
    stripNewLines: false,
    timeout: options.timeoutMs ?? 60_000,
    maxRetries: 2,
    ...(options.sendDimensions ? { dimensions: env.EMBEDDINGS_DIMENSIONS } : {}),
  });
  return wrapEmbeddings(lc, env.EMBEDDINGS_DIMENSIONS, options, env.EMBEDDINGS_MODEL);
}

export function createChatModelClient(env: ModelsEnv): ChatModelClient {
  const model = new ChatOpenAI({
    model: env.CHAT_MODEL,
    apiKey: env.CHAT_API_KEY || NO_KEY,
    configuration: { baseURL: env.CHAT_BASE_URL },
    ...(env.CHAT_TEMPERATURE === undefined ? {} : { temperature: env.CHAT_TEMPERATURE }),
    maxTokens: env.CHAT_MAX_TOKENS,
    streaming: true,
    maxRetries: 1,
  });
  return {
    async *stream(messages: ChatMessage[], signal: AbortSignal) {
      const stream = await model.stream(
        messages.map((m) => ({ role: m.role, content: m.content })),
        { signal },
      );
      for await (const chunk of stream) {
        const c = chunk.content as unknown;
        if (typeof c === "string") {
          if (c) yield c;
        } else if (Array.isArray(c)) {
          for (const part of c as { type?: string; text?: string }[]) {
            if (part?.type === "text" && part.text) yield part.text;
          }
        }
      }
    },
  };
}
