import type { SourceDocument } from "@docs-platform/contracts";
import { countIndex, insertChunks, insertDocument, withTransaction, type Pool } from "@docs-platform/storage";
import { chunkDocument, type ChunkOptions } from "./chunk.js";
import type { Chunk, EmbeddingsClient, Logger } from "./types.js";
import { noopLogger } from "./types.js";

export interface IndexReleaseInput {
  pool: Pool;
  /** The release row must already exist as CANDIDATE; the caller creates it and marks it FAILED on error. */
  releaseId: string;
  documents: SourceDocument[];
  embeddings: EmbeddingsClient;
  log?: Logger;
  signal?: AbortSignal;
  chunking?: ChunkOptions;
  /** Chunks embedded per group before inserting (default 256). */
  groupSize?: number;
}

export interface IndexResult {
  documents: number;
  chunks: number;
}

/** Embeds and stores every document. Throws on any failure; nothing is marked FAILED here. */
export async function indexRelease(input: IndexReleaseInput): Promise<IndexResult> {
  const { pool, releaseId, documents, embeddings, signal } = input;
  const log = input.log ?? noopLogger;
  const groupSize = input.groupSize ?? 256;
  let docCount = 0;
  let chunkCount = 0;

  let group: { doc: SourceDocument; chunks: Chunk[] }[] = [];
  let pending = 0;
  const flush = async (): Promise<void> => {
    if (group.length === 0) return;
    const texts = group.flatMap((g) => g.chunks.map((c) => c.embedText));
    const vectors = texts.length ? await embeddings.embedDocuments(texts, signal) : [];
    signal?.throwIfAborted();
    let v = 0;
    for (const { doc, chunks } of group) {
      await withTransaction(pool, async (tx) => {
        const documentId = await insertDocument(tx, {
          releaseId,
          sourcePath: doc.path,
          renderedUrl: doc.metadata.url,
          title: doc.metadata.title,
          checksum: doc.checksum,
        });
        await insertChunks(
          tx,
          documentId,
          chunks.map((c) => ({
            ordinal: c.ordinal,
            heading: c.heading ?? null,
            anchor: c.anchor ?? null,
            content: c.content,
            tokenCount: Math.ceil(c.content.length / 4),
            embedding: vectors[v++]!,
          })),
        );
      });
      docCount++;
      chunkCount += chunks.length;
    }
    log.debug({ releaseId, documents: docCount, chunks: chunkCount }, "indexed batch");
    group = [];
    pending = 0;
  };

  for (const doc of documents) {
    signal?.throwIfAborted();
    const chunks = await chunkDocument(doc, input.chunking);
    group.push({ doc, chunks });
    pending += chunks.length;
    if (pending >= groupSize) await flush();
  }
  await flush();

  const counted = await countIndex(pool, releaseId);
  if (counted.documents !== docCount || counted.chunks !== chunkCount) {
    throw new Error(
      `index verification failed for ${releaseId}: wrote ${docCount} documents / ${chunkCount} chunks, ` +
        `database has ${counted.documents} / ${counted.chunks}`,
    );
  }
  log.info({ releaseId, ...counted }, "release indexed");
  return counted;
}
