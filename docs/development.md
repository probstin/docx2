# Local development

How to run the platform's full chain on one machine: Markdown → built site → vector index → API → chat widget. Kubernetes, webhooks and the gateway come in later waves. Locally, you build and index by hand, and the API runs without auth.

## Prerequisites

- Node 24 and pnpm 10 (`corepack enable`), plus Docker Desktop.
- `pnpm install`
- `pnpm db:up` starts Postgres 17 + pgvector on `localhost:5432`.
- `cp .env.example .env`. The defaults point at the mock model server. Put real endpoints and keys in `.env`; see [Real models](#real-models).

Each terminal below needs the env loaded: `set -a; . ./.env; set +a`.

## Run the full chain

```bash
# 1. Mock OpenAI-compatible models on :4010 (skip this if .env points at real endpoints)
pnpm --filter @docs-platform/mock-openai start

# 2. Build the site and index the same content under one release id.
#    The release id is baked into the site; chat only answers for indexed, active/retained releases.
R=$(date -u +%Y%m%d%H%M%S)-000000000001
pnpm --filter @docs-platform/builder site  --source "$PWD/examples/sample-docs" --out "$PWD/.data/site" --release-id $R
pnpm --filter @docs-platform/builder index --source "$PWD/examples/sample-docs" --release-id $R --activate

# 3. API on :8080. No gateway runs locally, so use the development-only no-auth mode.
AUTH_MODE=none AUTH_ALLOW_INSECURE_NONE=true pnpm --filter @docs-platform/api dev

# 4. Docs site with hot reload on :3000. /api is proxied to :8080.
DEV_RELEASE_ID=$R pnpm dev:site
```

Open http://localhost:3000/docs/ and use the chat launcher (bottom right). Point `dev:site` at your own Markdown repo with `pnpm dev:site path/to/docs-repo`, and index the same directory in step 2.

To exercise the trusted-header mode instead, leave `AUTH_MODE` at its default and send `x-auth-request-user: <name>` yourself, for example with curl:

```bash
curl -N localhost:8080/api/v1/chat -H 'x-auth-request-user: alice' -H 'content-type: application/json' \
  -d "{\"message\":\"How long does rolling back take?\",\"context\":{\"releaseId\":\"$R\",\"pageUrl\":\"/docs/guides/deployment\"}}"
```

## Real models

Set these in `.env`:

- **Chat model:** `CHAT_BASE_URL`, `CHAT_MODEL`, `CHAT_API_KEY`
- **Embeddings model:** `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_API_KEY`
- **`EMBEDDINGS_DIMENSIONS`:** must equal the model's output size. Every call is checked against it.
- **Retrieval:** `RETRIEVAL_MIN_SCORE` is 0.22 in `.env.example`, which is tuned for the lexical mock embedder. Start real models around 0.3 and tune from there. A low value lets weak matches through; a high value makes the assistant decline more often.
- **Chat temperature:** `CHAT_TEMPERATURE` is sent only when set. Leave it unset for reasoning models, which reject any value but their default.
- **Re-index after any embedding model change.** Chat refuses a release that was indexed with a different embedding model or dimension.
- **Private CA:** set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm format:check
set -a; . ./.env.example; set +a; pnpm test   # includes Postgres tests and real Docusaurus builds (~1 min)
SKIP_SLOW_TESTS=1 pnpm test                   # skip the Docusaurus builds while iterating
```

The golden retrieval suite (`packages/rag/fixtures/golden.yaml`) indexes the sample docs with the mock embedder. It checks that each question retrieves the expected section and that out-of-scope questions are declined.
