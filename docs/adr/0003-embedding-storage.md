# 0003 — Release-scoped embeddings with dimension recorded per release

**Status:** Accepted (Wave 0)

## Decision

- `document_chunks.embedding` is an **untyped `vector`** column. Each release stores its `embedding_model` and `embedding_dimensions`, and a trigger/check rejects chunks whose `vector_dims()` doesn't match their release.
- Every retrieval query filters by `release_id`, so only vectors of one dimension are ever compared. Exact (sequential) cosine search is the MVP. An ANN index can be added later as a partial expression index per dimension (`(embedding::vector(1024)) WHERE …`) once corpus size justifies it (PLAN §10.1).
- Changing the embedding model or dimension needs no migration. The next build indexes a full new release with the new metadata.
- LangChain.js supplies splitters and the OpenAI-compatible embeddings/chat clients, behind project-owned interfaces in `packages/rag`. Persistence and retrieval use **application-owned parameterized SQL** in `packages/storage`, because LangChain's PGVector store doesn't model release lifecycle (PLAN §16 risk).
- Migrations are plain ordered SQL files run by a small project-owned runner that records them in a `schema_migrations` table under a PostgreSQL advisory lock, so concurrent Helm hook/Job runs are safe.

## Consequences

The schema doesn't depend on Helm values. Model changes take effect at the next build. Retrieval cost is linear in a single release's chunk count, which is acceptable at MVP scale.
