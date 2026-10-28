# 0005 — Gitea as the initial Git provider; kind as the integration cluster

**Status:** Accepted (Wave 0)

## Decision

- The first webhook adapter targets **Gitea**: `X-Gitea-Event: push`, with an HMAC-SHA256 hex signature of the raw body in `X-Gitea-Signature`, compared in constant time. The adapter checks the repository (`repository.clone_url` / `full_name`) against `SOURCE_GIT_URL`, checks the branch from `ref`, and enqueues `after` as the SHA. Branch-deletion pushes (all-zero `after`) are ignored. Provider parsing sits behind a `WebhookAdapter` interface, so GitHub/GitLab can be added later.
- **kind** is the integration and E2E cluster. Gitea runs in-cluster and hosts the sample docs repository. Postgres+pgvector, ingress-nginx, oauth2-proxy (with a test OIDC issuer), and the platform's own chart are installed into kind for the Wave 3–4 proofs. Unit and service-level development uses `docker compose` Postgres and the mock model server.
