# Docs Platform — MVP Implementation Plan

> **Status:** Proposed implementation baseline  
> **Version:** 1.0  
> **Prepared:** 2026-10-27  
> **Product:** Self-hosted, Git-native, RAG-powered documentation platform  
> **Primary deployment model:** One isolated Helm release per documentation repository

## 1. Vision and outcome

Build a simple, repeatable documentation platform that development teams can adopt without becoming experts in Docusaurus, RAG, CI/CD, or vector databases.

A team maintains **Markdown, assets, and a small `docs.yaml` file** in a private Git repository. An operator deploys the platform using a Helm chart, supplying Git access, an existing PostgreSQL/pgvector database, internal OpenAI-compatible chat and embedding services, storage, and ingress configuration. The platform then:

1. Clones the repository and generates a branded static documentation site.
2. Ingests the same documentation revision into a searchable vector index.
3. Serves the documentation with an embedded AI chat assistant that can expand into a full-screen workspace.
4. Answers questions using streamed, grounded responses and links back to relevant documentation sections.
5. Reacts to signed Git webhooks by rebuilding and republishing both the site and its corresponding RAG index **without requiring a team-owned CI/CD pipeline**.
6. Runs entirely within an air-gapped Kubernetes environment with privately hosted dependencies, images, Helm charts, Git repositories, and model endpoints.

**North-star adoption flow:** supply a repository and a small set of Helm values → install → receive a protected documentation site and AI assistant → push Markdown → see the documentation and index update automatically.

## 2. Users and responsibilities

| Persona | Owns | Does not need to own |
| --- | --- | --- |
| Documentation team | Markdown, images, site metadata, content review | Docusaurus application, RAG pipeline, Kubernetes Jobs, model integrations |
| Platform operator | Helm release, Git/webhook credentials, PostgreSQL, PVC, private images, ingress, model connections | Each team's documentation content |
| Documentation reader | Reading docs, asking questions, following source citations | Authentication tokens or RAG internals |
| Enterprise identity team | OIDC identity provider, oauth2-proxy or equivalent, trusted gateway configuration | Application login implementation |

## 3. Architectural decisions (locked for MVP)

| Concern | Decision |
| --- | --- |
| Implementation language | **TypeScript** across the application, builder, adapters, contracts, and React UI |
| Deployment | **One Helm release per documentation Git repository**; no shared multitenant application |
| Documentation | **Docusaurus**, assembled from a platform-owned template |
| Team repository | **Markdown + assets + minimal `docs.yaml`**; no `package.json` or custom Docusaurus application required |
| Chat | Embedded React widget; expand/collapse to a full-screen view; streaming, citations, and page context |
| API | **Fastify** on Node.js |
| RAG framework | **LangChain.js** for supported loaders/splitters, embeddings, retrieval, and generation integration; wrap framework APIs behind project-owned interfaces |
| Database | **Existing PostgreSQL with pgvector**, with schema managed by platform migrations |
| AI models | **Separate OpenAI-compatible endpoints** for LLM and embeddings; configurable base URLs, model names, and Secret-sourced API keys |
| Authentication | **Delegated to an external trusted ingress/gateway**; no native OAuth login flow in the application |
| Identity | Configurable trusted-header mapping; missing required subject returns **401** from protected API endpoints |
| oauth2-proxy | **Supported reference integration**, not a mandatory bundled service |
| Updates | Authenticated **Git webhook → persistent build queue → Kubernetes Job → validated publish** |
| Static artifacts | **Kubernetes PVC**, preferably a `ReadWriteMany` (RWX) storage class for concurrent builder and web Pod mounting |
| Release strategy | Immutable website revisions and matching, release-scoped document embeddings; rollback preserves both |
| Distribution | OCI images and Helm chart mirrored/published to private registries; no mandatory internet access |

### Assumptions to validate in the first spike

- The target cluster has an RWX-capable storage class or a pre-provisioned shared PVC.
- The supplied PostgreSQL supports the `vector` extension and required DDL/extension privileges are available to an operator or migration process.
- The internal chat endpoint supports the needed OpenAI-compatible streaming semantics; the embedding endpoint supports embeddings of a known fixed dimension.
- The Git service can send an inbound signed webhook to a narrowly exposed route. **The initial provider must be chosen by the implementation team** (for example, GitHub Enterprise); provider-specific signature/event parsing is an adapter.
- The platform can run its pinned Node/Docusaurus builder image without reaching public package registries.
- The chosen ingress/controller supports an external-auth integration, or the implementer can provide an equivalent verified-identity gateway.

## 4. Scope

### 4.1 Must-have functional requirements

**Documentation**

- Read one configured branch of one authenticated private Git repository per release.
- Accept Markdown/Markdown-compatible frontmatter and local images/assets.
- Validate `docs.yaml` against a versioned schema; generate navigation, branding, and Docusaurus configuration.
- Produce responsive static HTML, CSS, and JavaScript using a fixed platform-owned template and dependency set.
- Provide working documentation paths and stable heading anchors for citations.
- Trigger an initial build after installation, manual rebuilds, and automatic rebuilds on relevant Git events.

**AI assistant**

- Provide a floating/embedded assistant on documentation pages.
- Expand to a full-screen experience while retaining the same conversation.
- Stream answers and render Markdown, fenced code, syntax highlighting, and copyable snippets.
- Search documentation via vector similarity and attach real source links, headings, and release IDs.
- Use current page URL/title/heading as retrieval signals, not as exclusive retrieval filters.
- Return an explicit “not supported by available documentation” response when retrieval is inadequate.
- Support browser-session conversation state; server-side persistent chat history is not required in MVP.

**Platform and publishing**

- Authenticate Git checkout to private servers using Kubernetes Secrets.
- Verify webhook authenticity and reject unrelated repositories, event types, and branches.
- Persist jobs and release status in PostgreSQL; make retries, deduplication, and restart recovery safe.
- Launch sandboxed, bounded Kubernetes build Jobs using a prebuilt builder image.
- Build the website and stage a **matching** RAG index for the exact Git commit.
- Publish only after build and indexing validation pass; preserve the previously working release on failure.
- Support manual republish and release rollback, with retained revisions.
- Expose authenticated build status/administration and internal health/metrics endpoints.

**Authentication and authorization**

- Require a trusted gateway to protect **both** static pages/assets and the chat/API routes.
- Accept configurable verified identity attributes (subject required; email, display name, and groups optional).
- Reject protected API requests without a nonempty verified subject (`401`).
- Restrict administration via configurable trusted groups/claims or an operator-only authorization rule (`403` when authenticated but unauthorized).
- Apply **separate webhook authentication** instead of requiring an interactive OIDC session for Git events.

### 4.2 Operational and nonfunctional requirements

- TypeScript-only application code; reproducible pinned dependencies and container images.
- No dependency installation from public registries when building customer docs at runtime.
- Private OCI image pulls and Helm chart distribution, including registry credentials.
- Configurable CA certificates for internal Git, PostgreSQL, OIDC infrastructure, and model endpoints.
- Kubernetes Secrets for credentials; no secrets in `docs.yaml`, static artifacts, logs, or browser JavaScript.
- Container security contexts, scoped RBAC, network isolation, limits, timeouts, and controlled egress.
- Structured logs, build state history, readiness/liveness, baseline metrics, and useful build diagnostics.
- A documented backup/restore strategy for PostgreSQL and the PVC; test rollback with both resources.
- No mandatory external telemetry, hosted model gateway, or SaaS dependency.

### 4.3 Explicitly deferred

- A centrally hosted multitenant documentation service.
- Multi-repository federation or document-level permission filtering.
- Built-in OIDC/OAuth authorization-code flow, token refresh, and user account management.
- Bundled oauth2-proxy, mandatory enterprise identity provider, or a custom identity service.
- Arbitrary MDX components, repository-provided JavaScript, custom npm installs, or arbitrary build hooks.
- Complex agents and tool execution; autonomous code actions.
- Persistent cross-device chat history, user feedback workflows, and analytics dashboards.
- GUI documentation editing or GUI administration.
- Confluence/object-storage/OpenAPI ingestion implementations (only the extension contracts are included).
- Incremental embedding optimization; initially index a complete new release on every successful build.
- A Kubernetes operator, Tekton/Jenkins dependency, dedicated message broker, or external CI requirement.

## 5. High-level architecture

```text
                        Enterprise OIDC Provider
                                  ^
                                  |
Browser <--> Trusted Ingress / oauth2-proxy (or equivalent)
                  |                  |
           protected site       protected API
                  |                  |
       Static Web Deployment    Fastify Platform API
       Docusaurus + AskAI       - chat / identity
                  |             - admin / build controller
                  |             - signed webhook route*
                  |                  |
             Artifact PVC        PostgreSQL + pgvector
          immutable revisions    builds / releases / chunks
                  ^                  ^
                  |                  |
              Kubernetes Build Job (ephemeral)
              Git checkout + Docusaurus build
              Markdown parsing + embeddings
                  |                  |
            Private Git       Internal embedding API
                                     |
                                Internal LLM API

*Webhook uses a distinct ingress route, provider signature validation,
 and no interactive OIDC redirect.
```

### 5.1 Workloads and dependencies

| Component | Form | Responsibility |
| --- | --- | --- |
| `web` | Kubernetes Deployment + Service | Serve validated published static files on PVC; protected by gateway |
| `api` | Kubernetes Deployment + Service | Fastify chat API, identity adapter, retrieval, build/admin endpoints, webhook receiver, scheduler/reconciler |
| `builder` | Ephemeral Kubernetes Job | Checkout exact commit, render static site, create embeddings, validate, stage artifacts |
| `artifact-pvc` | PVC (RWX default) | Immutable release directories, staging, manifests, active site pointer/asset retention |
| `postgres` | External service | Vector search, documents/chunks, build queue/state, release registry |
| `chat-model` | Configured internal HTTPS endpoint | OpenAI-compatible chat/completion streaming |
| `embedding-model` | Configured internal HTTPS endpoint | OpenAI-compatible embeddings |
| `ingress/gateway` | Implementer-managed | OIDC session enforcement and sanitized, verified identity propagation |
| `oauth2-proxy` | Optional external integration | OIDC authentication and auth-request response headers |

**MVP scaling:** one API instance running the scheduler is sufficient; only one build at a time per release. If API replicas increase, implement leader election or PostgreSQL advisory/row locking before allowing multiple reconcilers.

### 5.2 Source and RAG extension boundaries

Define narrow interfaces so future sources and model providers can be added without rewriting ingestion or chat:

```ts
interface SourceAdapter {
  fetch(reference: SourceReference): Promise<SourceSnapshot>;
}

interface SourceSnapshot {
  revision: string; // Git SHA for the MVP
  documents: AsyncIterable<SourceDocument>;
}

interface SourceDocument {
  id: string;
  path: string;
  content: string;
  checksum: string;
  metadata: {
    title: string;
    url: string;
    headings: Array<{ text: string; anchor: string }>;
  };
}

interface Identity {
  subject: string;
  email?: string;
  displayName?: string;
  groups: string[];
}
```

Implement `GitMarkdownSourceAdapter` first; make the RAG layer replaceable behind ingestion and retrieval interfaces. Use LangChain.js where it provides maintained abstractions, but retain application-owned database migrations, release metadata, and publication semantics.

## 6. Repositories and packaging

### 6.1 Centrally maintained platform repository

```text
docs-platform/
├── apps/
│   ├── api/                        # Fastify routes, middleware, scheduler
│   └── builder/                    # Git checkout, site build, indexing
├── packages/
│   ├── contracts/                  # Versioned schemas / shared types
│   ├── auth/                       # Trusted-header identity adapter
│   ├── sources/                    # Git Markdown connector and interfaces
│   ├── rag/                        # LangChain-backed ingestion/retrieval
│   ├── storage/                    # PostgreSQL, pgvector, releases
│   ├── chat-react/                 # Shared widget + full-screen UI
│   └── docusaurus-template/        # Fixed site build template/theme
├── charts/docs-platform/          # Helm templates + values.schema.json
├── docker/                         # Pinned API, builder, web images
├── examples/
│   ├── sample-docs/
│   └── oauth2-proxy/               # Reference configuration
├── tests/                          # Unit / integration / e2e
└── pnpm-workspace.yaml
```

### 6.2 Team-owned documentation repository

```text
team-docs/
├── docs.yaml
├── docs/
│   ├── index.md
│   ├── getting-started.md
│   ├── architecture/overview.md
│   └── guides/deployment.md
└── assets/
    ├── logo.svg
    └── images/
```

The platform owns the Docusaurus project, npm dependencies, build scripts, plugins, and chat integration. Repositories cannot inject executable build-time code in MVP.

## 7. Configuration contracts

Configuration is split into **team-owned content configuration** (`docs.yaml`) and **operator-owned deployment configuration** (Helm values). Both schemas are versioned and validated at startup/build time.

### 7.1 `docs.yaml` — illustrative v1 contract

```yaml
schemaVersion: 1
site:
  title: Platform Engineering
  tagline: Internal developer documentation
  basePath: /
  logo: assets/logo.svg
navigation:
  mode: autogenerated
content:
  root: docs
  landingPage: index.md
  exclude:
    - "**/_drafts/**"
theme:
  mode: system
  primaryColor: "#2563eb"
assistant:
  enabled: true
  title: Ask Engineering AI
  welcomeMessage: How can I help?
  pageContext: true
  citations: true
  expandable: true
```

**Rules:** content paths are normalized and constrained to the checkout; unsupported keys fail validation. Team configuration must not modify endpoint URLs, Secrets, RBAC, network policies, executable plugins, or other privileged runtime settings.

### 7.2 Helm values — illustrative v1 contract

```yaml
global:
  imageRegistry: registry.internal.example.com
  imagePullSecrets:
    - name: private-registry

platform:
  publicUrl: https://docs.internal.example.com

source:
  type: git
  url: https://git.internal.example.com/team/docs.git
  branch: main
  credentialsSecret: docs-git-credentials
  webhook:
    enabled: true
    provider: github             # MVP example; select actual provider
    secretName: docs-webhook-secret

models:
  chat:
    baseUrl: https://llm.internal.example.com/v1
    model: internal-chat-model
    apiKeySecret:
      name: llm-credentials
      key: api-key
    temperature: 0.2
  embeddings:
    baseUrl: https://embeddings.internal.example.com/v1
    model: internal-embedding-model
    apiKeySecret:
      name: embeddings-credentials
      key: api-key
    dimensions: 1024             # must match the actual model output

database:
  host: postgres.internal.example.com
  port: 5432
  name: docs_platform
  credentialsSecret: docs-db-credentials
  sslMode: verify-full

storage:
  type: pvc
  existingClaim: ""
  storageClass: shared-rwx
  accessModes: [ReadWriteMany]
  size: 5Gi

auth:
  mode: trusted-header
  subjectHeader: X-Auth-Request-User
  emailHeader: X-Auth-Request-Email
  groupsHeader: X-Auth-Request-Groups
  required: true
  adminGroups: [docs-admins]

ingress:
  enabled: true
  # Auth configuration is supplied by trusted gateway implementation.
  # Reference ingress-nginx + oauth2-proxy example is distributed separately.

publishing:
  maxConcurrentBuilds: 1
  retainRevisions: 3
  jobTimeoutSeconds: 900
  jobTtlSecondsAfterFinished: 3600

chat:
  streaming: true
  retrieval:
    topK: 8
    pageContextBoost: true
```

**Credentials:** all secret references identify existing Kubernetes Secrets; the chart must never require plaintext keys in Helm values. Kubernetes resource settings, CA bundles, security contexts, network policies, private proxy options, and replica counts remain configurable.

**Schema deliverables:** `docs.yaml` Zod schema, `values.schema.json`, sample values, annotated configuration reference, negative schema validation tests.

## 8. Authentication and oauth2-proxy integration

### 8.1 Trust boundary

**Recommended deployment:** Browser → enterprise gateway/ingress → protected `web` or protected `api`. The gateway delegates OIDC to oauth2-proxy (or another enterprise solution), validates the user's session, strips user-supplied identity headers, and injects **verified** headers into upstream requests.

The application **does not** perform OAuth redirects or manage OIDC tokens. The API maps trusted headers to:

```ts
type PlatformIdentity = {
  subject: string;      // nonempty, required; ideally stable immutable ID
  email?: string;
  displayName?: string;
  groups: string[];
};
```

- Protected API with missing/blank subject: `401 Unauthorized`.
- Authenticated user without required admin privileges: `403 Forbidden`.
- Site pages and assets: access controlled by the gateway, not by Docusaurus.
- API's header check is **defense-in-depth only**; untrusted callers must never have direct network access to the API.
- Do not assume `X-Auth-Request-User` is the OIDC immutable `sub`. Confirm the claim mapping of the chosen identity provider and proxy; make the subject header configurable.
- Gateway must strip/overwrite client-provided identity and forwarding headers; restrict upstream connections using NetworkPolicies, gateway isolation, and optionally mTLS.
- A development-only no-auth mode may be allowed behind an explicit opt-in, never as production default.

### 8.2 oauth2-proxy reference integration deliverable

Provide a tested `examples/oauth2-proxy/` directory documenting:

1. A separate oauth2-proxy installation configured for an internal OIDC issuer.
2. `--reverse-proxy=true`, `--set-xauthrequest=true`, secure session cookies, and suitable OAuth callback/start routes.
3. An ingress-nginx **auth-request** example for the docs site and protected API; response headers such as `X-Auth-Request-User` and `X-Auth-Request-Email` are forwarded only from the successful auth subrequest.
4. A separate, unprotected-by-OIDC `/oauth2/*` route to oauth2-proxy to prevent redirect loops.
5. A *distinct* Git webhook ingress that uses signature validation, rate/size limits, and optionally source-network restrictions, rather than browser OIDC.
6. Security verification procedures: spoofed identity headers rejected/stripped; no direct upstream access; unauthenticated docs redirect/login; protected API returns 401 if identity is absent.

> OAuth2 Proxy's `X-Auth-Request-User` value may be a username rather than the immutable subject. The deployment reference must document the exact mapping it uses.

### 8.3 Route/auth matrix

| Route | Authentication | Purpose |
| --- | --- | --- |
| `/`, `/docs/*`, static assets | Gateway OIDC session | Docs site |
| `POST /api/v1/chat` | Gateway OIDC + required identity | Stream answers |
| `GET /api/v1/site` | Gateway OIDC + required identity | Site/release metadata |
| `/api/v1/builds*`, `/api/v1/releases*` | Gateway OIDC + admin authorization | Operations |
| `POST /api/v1/webhooks/git` | Verified provider webhook signature | Git event ingestion |
| `/oauth2/*` | oauth2-proxy controlled | Login/session/callback |
| `/health/*`, `/metrics` | Private/internal-only access | Runtime health and monitoring |

## 9. Git-to-publication lifecycle

### 9.1 State machine

`RECEIVED → QUEUED → CHECKOUT → BUILDING → INDEXING → VALIDATING → READY → PUBLISHING → ACTIVE`

Error paths: `FAILED` with actionable failure detail. `SUPERSEDED` may be used for older queued commits. `ROLLED_BACK` or an activation event records a release switch.

### 9.2 Exact workflow

1. **Webhook received:** validate HMAC/token as required by the Git provider, payload shape, repository ID, branch, and permitted event. Acknowledge promptly; no build work in the HTTP request.
2. **Queue:** persist event and exact commit SHA. Deduplicate `(repo, sha)`; serialize builds; optionally coalesce obsolete queued commits.
3. **Dispatch:** create a bounded Kubernetes Job using an approved prebuilt builder image, a restricted service account, pinned resources, secrets, CA bundles, and an active deadline.
4. **Checkout:** authenticate to private Git, fetch/check out the exact SHA, and verify repository identity; do not rely on a moving branch name after queuing.
5. **Validate source:** parse `docs.yaml`, normalize paths, reject unsupported scripts/components, and detect missing or unsafe assets.
6. **Build site:** inject the content into the platform-owned Docusaurus template; generate site HTML/assets/navigation and verify links.
7. **Stage index:** parse the same revision, split by meaningful document/heading boundaries, generate embeddings through the internal API, and persist chunks under a **candidate release ID**. Never mutate the active release in place.
8. **Validate candidate:** verify site manifest, expected files, link anchors, index completeness, vector dimensions, and representative retrieval checks; compare metadata against the Git SHA.
9. **Stage artifact:** write files into a unique, immutable PVC revision directory; ensure it is complete before marking ready.
10. **Promote:** controller coordinates an active release pointer in PostgreSQL and a web-visible atomic pointer/routing mechanism. Keep all prior active artifacts and index data until safe to retire.
11. **Reconcile and report:** handle interrupted promotions, update build status, expose diagnostics, and prune only unreferenced retained revisions and expired Jobs.

### 9.3 PVC layout

```text
/data/
├── staging/
│   └── build-<job-id>/
├── releases/
│   ├── <release-id-A>/
│   │   ├── site/
│   │   └── manifest.json
│   └── <release-id-B>/
│       ├── site/
│       └── manifest.json
├── shared-assets/               # if chosen for cross-release asset serving
└── current -> releases/<active-release-id>/site
```

**Consistency requirements:**

- The PVC and PostgreSQL do not support a cross-resource transaction. Promotion **must be idempotent and recoverable**.
- Stage artifacts and index data first; promote only a validated candidate. Keep the previous revision live on any failure.
- Embed the release ID in the generated website's chat configuration. Chat requests carry that release ID; the API retrieves **only chunks from that revision** and rejects unknown/pruned IDs.
- Ensure HTML loaded just before a switch can still load its fingerprinted JavaScript/CSS. Adopt **versioned asset paths or retention-aware shared assets**; a symlink flip alone is not sufficient to guarantee this. This must be exercised in end-to-end tests.
- Retain old RAG rows and site assets while referenced by live sessions and the rollback window; manage garbage collection carefully.
- The serving mechanism must actually follow the active revision/pointer; do not assume a PostgreSQL update automatically switches NGINX's doc root.
- Define restart recovery for interrupted Jobs, failed pointer swaps, incomplete manifests, and abandoned staging directories.

### 9.4 Build security and offline constraints

- Builder image contains pinned Node, Git, Docusaurus template, and all production build dependencies.
- The content repository is **data**, not a source of executable code; no arbitrary `npm install`, package scripts, MDX imports, or remote module resolution.
- Job filesystem is restricted to checkout workspace and approved artifact paths; validate symlinks and path traversal.
- Use workload-specific Kubernetes service accounts; builder must **not** have Job-creation permissions.
- Restrict egress to private Git, approved model APIs, PostgreSQL, and required internal infrastructure.
- Mount Git/model/database credentials using Kubernetes Secrets; minimize exposure across containers.
- Fail fast on network access outside the air-gapped dependency allowlist.

## 10. RAG ingestion and retrieval

### 10.1 Ingestion

- Markdown source is parsed with structure preservation: frontmatter title, headings, anchor IDs, relative file path, rendered route, and content checksum.
- Split documents by sections, then by token/window size when necessary; preserve overlap and section metadata.
- Generate vectors through configurable OpenAI-compatible embeddings client; validate returned vector dimension before persistence.
- Write all source metadata and embeddings with `release_id` and originating Git SHA.
- Full-release indexing first; checksum-based cache reuse and incremental embeddings later.

Suggested relational model:

| Table | Relevant fields |
| --- | --- |
| `releases` | `id`, `git_sha`, `status`, `artifact_path`, `created_at`, `activated_at` |
| `builds` | `id`, `git_sha`, `status`, `k8s_job_name`, `error`, timestamps |
| `documents` | `id`, `release_id`, `source_path`, `rendered_url`, `title`, `checksum` |
| `document_chunks` | `id`, `release_id`, `document_id`, `ordinal`, `heading`, `anchor`, `content`, `embedding VECTOR(n)` |
| `release_events` | `id`, `release_id`, `type`, `details`, `occurred_at` |

Implement parameterized, release-filtered retrieval. Validate whether a LangChain.js PGVector integration meets the metadata/revision filtering and deletion requirements; use carefully bounded SQL where the framework does not support release semantics cleanly. For small initial document sets, benchmark exact similarity search before adding HNSW or other ANN indexes.

### 10.2 Answer pipeline

1. Require a trusted identity; resolve and validate `releaseId` supplied by the site's widget.
2. Accept question plus current page context (URL, title, heading), with size limits and normalization.
3. Generate query embeddings from the internal embedding model.
4. Retrieve relevant chunks via pgvector **filtered by release ID**; apply a page-context ranking boost, not a hard page filter.
5. Assemble a grounded prompt with citations and a bounded recent-message window.
6. Stream model output through the internal OpenAI-compatible chat service.
7. Send structured citation metadata containing document route, heading/anchor, title, and release ID.
8. Clearly decline to assert details that the indexed documentation does not support.

Treat retrieved content and client-provided page context as untrusted data; never promote them to system instructions.

## 11. Chat UI and API contracts

### 11.1 Experience

- Floating entry point integrated into the Docusaurus theme.
- Compact chat panel with a welcome prompt, text input, streaming output, and cancellation.
- Full-screen view optimized for long technical responses and code examples.
- Shared conversation state across expand/collapse; preserve history during navigation when practical.
- Render safe Markdown, fenced code, syntax highlighting, copy buttons, loading/error states, and clickable source citations.
- Mobile-responsive; accessible keyboard navigation and focus management.
- Explicit page context indicator, with current document section identified when available.

### 11.2 Proposed versioned HTTP API

| Endpoint | Behavior |
| --- | --- |
| `POST /api/v1/chat` | `text/event-stream` over a streamed HTTP POST |
| `GET /api/v1/site` | Site settings and active/published release metadata |
| `POST /api/v1/webhooks/git` | Validate, enqueue, acknowledge Git event |
| `POST /api/v1/builds` | Admin-triggered full rebuild |
| `GET /api/v1/builds` | Admin build history/status |
| `GET /api/v1/builds/:id` | Admin detailed build state |
| `POST /api/v1/releases/:id/activate` | Admin rollback/activation |
| `GET /health/live`, `GET /health/ready` | Internal probes |
| `GET /metrics` | Internal operational metrics |

Suggested request:

```ts
interface ChatRequest {
  message: string;
  conversationId?: string;
  context: {
    releaseId: string;
    pageUrl: string;
    pageTitle?: string;
    heading?: string;
  };
}

type ChatStreamEvent =
  | { type: "start"; messageId: string }
  | { type: "delta"; text: string }
  | { type: "citations"; sources: Citation[] }
  | { type: "done" }
  | { type: "error"; code: string; message: string };
```

The backend checks that `pageUrl` belongs to the configured site and that the supplied release is one of its published/retained revisions. Use SSE framing for streaming events and `AbortController` for user cancellation. Do not expose API/model keys to the browser.

## 12. Helm chart deliverables

```text
charts/docs-platform/
├── Chart.yaml
├── values.yaml
├── values.schema.json
└── templates/
    ├── api-deployment.yaml
    ├── api-service.yaml
    ├── web-deployment.yaml
    ├── web-service.yaml
    ├── ingress-protected.yaml
    ├── ingress-webhook.yaml
    ├── pvc.yaml
    ├── serviceaccount.yaml
    ├── role.yaml
    ├── rolebinding.yaml
    ├── networkpolicy.yaml
    ├── configmap.yaml
    ├── migration-job.yaml
    └── _helpers.tpl
```

The API creates transient builder Jobs dynamically; the Helm chart does not deploy a permanent builder Deployment. Chart hooks/migrations should be designed to avoid accidental double migrations and tolerate upgrades. Publish Helm charts and images to authenticated internal OCI registries.

### Operator quick-start (target experience)

```bash
helm upgrade --install engineering-docs \
  oci://registry.internal.example.com/charts/docs-platform \
  --namespace engineering-docs \
  --create-namespace \
  --values values.yaml
```

Installation should perform configuration validation, establish readiness, and enqueue an initial build even when webhooks have not yet fired. Failed first builds yield an observable initializing/unavailable site, not a half-generated website.

## 13. Development milestones, tasks, and deliverables

The milestones are ordered to de-risk offline building, storage consistency, and retrieval before optimizing UX or adding optional capabilities. Each should yield a runnable demonstration and automated tests.

### M0 — Technical proof-of-concept / feasibility gates

**Tasks**

- [ ] Validate Docusaurus can compile from a `docs.yaml` + Markdown-only repository using a fully prebuilt, offline builder image.
- [ ] Validate simultaneous web/read and builder/write access to selected RWX PVC across Kubernetes nodes.
- [ ] Validate chat streaming and embeddings using the actual internal OpenAI-compatible API implementations.
- [ ] Validate LangChain.js + PostgreSQL/pgvector with release-filtered retrieval and heading citations.
- [ ] Demonstrate oauth2-proxy/ingress verified headers, 401 fallback, and no header-spoof bypass.
- [ ] Prototype reliable release pointer swap and retained assets during concurrent requests.

**Deliverables:** technical spike repository, decision log, test evidence, confirmed minimum Kubernetes/PostgreSQL/Node versions and storage prerequisites.

**Exit condition:** critical integrations and security/storage assumptions are demonstrated, not merely documented.

### M1 — Platform foundation

**Tasks**

- [ ] Scaffold TypeScript/pnpm workspace, linting, tests, and shared Zod schemas.
- [ ] Implement Fastify service, error conventions, health probes, structured logging, OpenTelemetry-ready hooks.
- [ ] Provision local development PostgreSQL/pgvector and migrations.
- [ ] Build private-registry-ready API, builder, and web OCI images.
- [ ] Add sample docs repository, local development commands, and schema docs.

**Deliverables:** runnable local stack, image builds, migrations, sample configuration, automated base tests.

### M2 — Content-only Git → static site

**Tasks**

- [ ] Implement authenticated Git checkout and source adapter interface.
- [ ] Parse/validate `docs.yaml`, content paths, assets, frontmatter, and navigation.
- [ ] Generate Docusaurus configuration and static website from platform template.
- [ ] Integrate chat widget shell into generated site.
- [ ] Validate pages, local links, heading anchors, site URL/base path, and build output.

**Deliverables:** reproducible content-only repository build and a working Docusaurus site; sample branded site.

### M3 — RAG and streamed chat

**Tasks**

- [ ] Implement Markdown parsing, structural chunking, metadata, and release-scoped storage.
- [ ] Integrate independently configured chat and embedding endpoints via Secrets.
- [ ] Implement pgvector retrieval, metadata filtering, page-context boost, and provenance mapping.
- [ ] Implement SSE chat API with bounded prompts, cancellation, error states, and citations.
- [ ] Build a retrieval evaluation fixture with representative questions and expected source headings.

**Deliverables:** fully working documentation-grounded chat API with automated retrieval/citation tests.

### M4 — React chat experience

**Tasks**

- [ ] Build compact widget and full-screen assistant from shared React components.
- [ ] Preserve conversation state on expand/collapse; attach current page/heading.
- [ ] Render streaming Markdown, syntax-highlighted code, source links, copy actions, and empty/error states.
- [ ] Add responsive and accessibility tests, including mobile layouts and keyboard handling.

**Deliverables:** integrated, polished Docusaurus + AskAI experience.

### M5 — Webhook-driven Kubernetes publishing

**Tasks**

- [ ] Implement signed webhook adapter and deduplicated PostgreSQL-backed queue.
- [ ] Implement scheduler/reconciler, Kubernetes Job manifests, RBAC, timeouts, retries, and statuses.
- [ ] Stage artifacts and index snapshots against the same Git SHA.
- [ ] Implement immutable PVC releases, promotion, retained assets, rollback, and cleanup.
- [ ] Add initial build-on-install and admin-triggered rebuild.
- [ ] Ship the installation/upgradeable Helm chart.
- [ ] Test mid-build failure, network outage, pod restart, rollback, and simultaneous reader traffic.

**Deliverables:** a push to Git safely updates both live documentation and AI retrieval without an external CI pipeline.

### M6 — Authentication, air-gap, and operational hardening

**Tasks**

- [ ] Validate protected ingress for static and API paths and a separate signed webhook route.
- [ ] Ship oauth2-proxy + ingress-nginx reference configuration with tested claim/header mapping.
- [ ] Enforce missing-subject 401, admin 403, no upstream bypass, and network-policy isolation.
- [ ] Verify fully offline deployment/build with private charts, images, CA bundles, and internal models.
- [ ] Add metrics, build diagnostics, troubleshooting and backup/restore runbooks.
- [ ] Publish security guidance, sizing notes, installation instructions, upgrade and rollback docs.

**Deliverables:** signed/reproducible release artifacts, validated air-gapped Helm deployment, operator runbooks, security test report, demo.

## 14. Acceptance criteria / definition of done

### Adoption and documentation

- [ ] A team repository contains only supported Markdown/assets plus `docs.yaml`; it builds without a team-defined Node project.
- [ ] An operator installs the chart using private registries, existing Secrets, PostgreSQL, and a PVC.
- [ ] The first documentation site is generated automatically after install.
- [ ] Navigation, images, responsive theme, and heading-level links work.

### RAG and chat

- [ ] Both LLM and embedding endpoints are configurable independently (URL, model, Secret-sourced key).
- [ ] Every answer can produce valid links to retrieved documentation sources; unsupported claims are not presented as sourced facts.
- [ ] Streaming, cancellation, page context, code snippets, and full-screen transitions work.
- [ ] Retrieval is filtered by the website's release ID, including during rebuilds and rollback.

### Authentication and isolation

- [ ] Unauthenticated visitors cannot access docs pages/assets through the protected gateway.
- [ ] Missing verified identity on protected API routes produces `401`; unauthorized admin access produces `403`.
- [ ] Spoofed identity headers and direct API bypass attempts do not grant access.
- [ ] Signed webhooks can trigger builds without an interactive OIDC cookie; invalid signatures cannot.

### Publishing and operations

- [ ] An accepted Git event triggers exactly one effective build for a given commit, subject to explicit retry policy.
- [ ] Failed Git checkout/site build/embedding does not replace the active release.
- [ ] Successful publication exposes matching site and vector revisions, with no broken in-flight assets.
- [ ] Admin rollback reactivates a retained site and corresponding vector index.
- [ ] Build logs/status, readiness, errors, and basic metrics are available.
- [ ] A fresh air-gapped Kubernetes deployment and subsequent webhook rebuild succeed **without access to the public internet**.

## 15. Test strategy

| Category | Tests |
| --- | --- |
| Unit | Config schema validation, adapters, path normalization, identity mapping, release-state transitions |
| Integration | Git checkout, Docusaurus build, pgvector queries, embedding dimension checks, model streaming protocol |
| Contract | OIDC-proxy header names/claims, API SSE events, webhook signatures, `docs.yaml` v1 |
| End-to-end | Login → view docs → chat with citation → push Git → rebuild → read updated docs → rollback |
| Failure injection | Bad commit, missing assets, failed embedding response, DB disconnect, Job timeout, PVC write failure, interrupted promotion |
| Security | Spoofed identity, bypass attempts, unsigned webhook, path traversal, injected MDX/build scripts, Secret leakage |
| Air-gap | DNS/egress block to public internet during install, build, site runtime, and chat |
| Upgrade | Helm upgrades, schema migrations, retention/rollback across compatible revisions |

Create a golden-question suite covering finding relevant sections, distinguishing similar documents, page-context boosts, out-of-scope questions, and citations that resolve to real anchors.

## 16. Risks and mitigations

| Risk | Mitigation / early decision |
| --- | --- |
| RWX storage unavailable or inconsistent rename semantics | Validate storage class in M0; document shared-PVC prerequisite and atomic publishing test |
| Old HTML references assets removed by release switch | Retain fingerprinted assets with version-specific routing/shared asset retention; test concurrent page loads |
| Site and vector index diverge during rollout | Immutable candidate snapshots, embedded release ID, release-filtered queries, idempotent promotion/reconciler |
| oauth2-proxy header is mutable username rather than OIDC `sub` | Configurable subject mapping; verify provider claims; document stable identity recommendation |
| Header spoofing / gateway bypass | Strip and overwrite headers, separate Services/Ingress, NetworkPolicies, optional mTLS, negative tests |
| Build executing untrusted repo code | Markdown-only input, pinned platform template, no install scripts/custom MDX, restricted non-root build Jobs |
| Private Git or model TLS fails in air-gap | Custom CA bundle support and connectivity preflight; never bypass TLS validation |
| Embedding model or dimension changes | Validate dimensions; require full reindex for changes; version model metadata per release |
| Webhook delivery duplication/missed events | SHA deduplication, durable queue, manual rebuild, periodic optional reconciliation later |
| LangChain.js PGVector integration lacks required feature | Validate in M0; wrap adapters; use application-owned parameterized SQL for release-scoped operations |
| Large docs lead to slow indexing | Start with limits/concurrency/timeouts; add checksum caching/incremental indexing after MVP |

## 17. Delivery artifacts checklist

- [ ] Platform TypeScript monorepo and architecture decision records (ADRs).
- [ ] Fastify API image with identity middleware, chat, webhook, build/admin endpoints.
- [ ] Offline-capable builder image and safe content-only Docusaurus templating.
- [ ] Static web image and PVC-backed revision serving strategy.
- [ ] Markdown Git source adapter and extension interfaces.
- [ ] LangChain.js-based RAG integration and pgvector SQL migrations.
- [ ] React embedded widget and full-screen assistant.
- [ ] Helm chart, `values.schema.json`, sample environments, and Secrets contract.
- [ ] oauth2-proxy/ingress reference deployment and security checklist.
- [ ] Sample Markdown documentation repository with `docs.yaml`.
- [ ] Build/release controller, webhook adapters, safe promotion, retained rollback.
- [ ] Automated tests, golden RAG evaluation fixture, and air-gap validation scripts.
- [ ] Operator guide: install, configure, authenticate, publish, monitor, upgrade, restore, and rollback.
- [ ] Developer guide: create docs repo, configure `docs.yaml`, set up webhook, write source-friendly Markdown.

## 18. Implementation order and handoff

Start with **M0**, then **M1 → M2 → M3 → M4 → M5 → M6**. Build a vertical slice early: content-only repo → Docusaurus static output → embedded widget → pgvector answer with real citation. Then productionize publication and security.

Before implementing M5, agree on the concrete Git webhook provider, cluster ingress/controller, RWX storage class, internal image/Helm registry, and supported Kubernetes/PostgreSQL/Node versions. These are **environment integration choices**, not changes to the overall product architecture.

**MVP completion milestone:** An authenticated user opens a branded documentation site backed by a team-owned Markdown repository; pushes to Git produce a safe, automatic site and index update; the user can ask a streamed question in the widget or full-screen view and receive an answer with a valid source citation; the entire flow operates inside a disconnected Kubernetes environment.

---

## References consulted

- [Docusaurus CLI and static build](https://docusaurus.io/docs/cli)
- [Docusaurus production deployment](https://docusaurus.io/docs/deployment)
- [LangChain.js PGVector integration](https://docs.langchain.com/oss/javascript/integrations/vectorstores/pgvector)
- [OAuth2 Proxy NGINX integration](https://oauth2-proxy.github.io/oauth2-proxy/configuration/integrations/nginx/)
- [OAuth2 Proxy configuration: auth-request headers](https://github.com/oauth2-proxy/oauth2-proxy/blob/master/docs/docs/configuration/overview.md)
- [Kubernetes Persistent Volumes and access modes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Kubernetes Jobs and TTL cleanup](https://kubernetes.io/docs/concepts/workloads/controllers/job/)

**Document note:** Config examples are proposed platform contracts, not values accepted by an existing chart. Version and compatibility decisions must be fixed and integration-tested during M0/M1.
