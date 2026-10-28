import pgvector from "pgvector";
import { StorageError, type Queryable } from "./db.js";

export interface InsertDocumentInput {
  releaseId: string;
  sourcePath: string;
  renderedUrl: string;
  title: string;
  checksum: string;
}

export async function insertDocument(db: Queryable, doc: InsertDocumentInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO documents (release_id, source_path, rendered_url, title, checksum)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [doc.releaseId, doc.sourcePath, doc.renderedUrl, doc.title, doc.checksum],
  );
  return rows[0]!.id;
}

export interface ChunkInput {
  ordinal: number;
  heading?: string | null;
  anchor?: string | null;
  content: string;
  tokenCount?: number | null;
  embedding: number[];
}

const COLS = 8;
const BATCH = 500; // 500 * 8 = 4000 params, well under the 65535 limit

/** Batched multi-row insert. The DB trigger enforces the release's embedding dimension. */
export async function insertChunks(db: Queryable, documentId: string, chunks: ChunkInput[]): Promise<number> {
  if (chunks.length === 0) return 0;
  const doc = await db.query<{ release_id: string }>("SELECT release_id FROM documents WHERE id = $1", [
    documentId,
  ]);
  const releaseId = doc.rows[0]?.release_id;
  if (!releaseId) throw new StorageError("INVALID_ARGUMENT", `unknown document ${documentId}`);

  let inserted = 0;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const values: unknown[] = [];
    const tuples = slice.map((c, j) => {
      const o = j * COLS;
      values.push(
        releaseId,
        documentId,
        c.ordinal,
        c.heading ?? null,
        c.anchor ?? null,
        c.content,
        c.tokenCount ?? null,
        pgvector.toSql(c.embedding),
      );
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}::vector)`;
    });
    const res = await db.query(
      `INSERT INTO document_chunks (release_id, document_id, ordinal, heading, anchor, content, token_count, embedding)
       VALUES ${tuples.join(", ")}`,
      values,
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

export async function countIndex(
  db: Queryable,
  releaseId: string,
): Promise<{ documents: number; chunks: number }> {
  const { rows } = await db.query<{ documents: string; chunks: string }>(
    `SELECT (SELECT count(*) FROM documents WHERE release_id = $1) AS documents,
            (SELECT count(*) FROM document_chunks WHERE release_id = $1) AS chunks`,
    [releaseId],
  );
  return { documents: Number(rows[0]!.documents), chunks: Number(rows[0]!.chunks) };
}

export interface SearchChunksInput {
  releaseId: string;
  embedding: number[];
  limit: number;
}

export interface ChunkHit {
  chunkId: string;
  documentId: string;
  content: string;
  heading: string | null;
  anchor: string | null;
  ordinal: number;
  title: string;
  sourcePath: string;
  renderedUrl: string;
  /** 1 - cosine distance; higher is more similar. */
  score: number;
}

/** Exact cosine search restricted to one release. */
export async function searchChunks(db: Queryable, input: SearchChunksInput): Promise<ChunkHit[]> {
  const rel = await db.query<{ embedding_dimensions: number }>(
    "SELECT embedding_dimensions FROM releases WHERE id = $1",
    [input.releaseId],
  );
  const dims = rel.rows[0]?.embedding_dimensions;
  if (dims === undefined) throw new StorageError("RELEASE_NOT_FOUND", `unknown release ${input.releaseId}`);
  if (input.embedding.length !== dims || !input.embedding.every(Number.isFinite)) {
    throw new StorageError(
      "INVALID_EMBEDDING",
      `query embedding must be ${dims} finite numbers, got ${input.embedding.length}`,
    );
  }
  const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 200);
  const { rows } = await db.query<{
    chunk_id: string;
    document_id: string;
    content: string;
    heading: string | null;
    anchor: string | null;
    ordinal: number;
    title: string;
    source_path: string;
    rendered_url: string;
    score: number;
  }>(
    `SELECT c.id AS chunk_id, c.document_id, c.content, c.heading, c.anchor, c.ordinal,
            d.title, d.source_path, d.rendered_url,
            1 - (c.embedding <=> $1::vector) AS score
     FROM document_chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.release_id = $2
     ORDER BY c.embedding <=> $1::vector, c.document_id, c.ordinal
     LIMIT $3`,
    [pgvector.toSql(input.embedding), input.releaseId, limit],
  );
  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    content: r.content,
    heading: r.heading,
    anchor: r.anchor,
    ordinal: r.ordinal,
    title: r.title,
    sourcePath: r.source_path,
    renderedUrl: r.rendered_url,
    score: Number(r.score),
  }));
}
