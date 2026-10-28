---
title: On-call handbook
sidebar_position: 3
description: Paging, severity levels and troubleshooting for Atlas on-call engineers.
---

# On-call handbook

The Atlas on-call rotation changes every **Tuesday at 10:00 UTC**.

## Severity levels

| Level | Meaning                       | Response target   |
| ----- | ----------------------------- | ----------------- |
| SEV1  | Production deploys impossible | 5 minutes         |
| SEV2  | Degraded performance          | 30 minutes        |
| SEV3  | Cosmetic or single-tenant     | Next business day |

Page the primary through the `#atlas-oncall` channel with `/page atlas`.

## Troubleshooting

Work through these checks in order:

1. Run `atlasctl status` and confirm the Scheduler reports `ready`.
2. Check the Gateway on port `8443` with `curl -k https://localhost:8443/healthz`.
3. Inspect the `atlas_state` database; if it is unreachable, follow [the architecture notes](../architecture/overview.md#health).

### Stuck deployment

A deployment stuck for more than 15 minutes should be cancelled with `atlasctl cancel <deploy-id>`, then [rolled back](./deployment.md#rollback).

### Build failures

Forge retries a failed build **twice**. After that, the build is marked `failed` and the logs are kept for 7 days.

## Escalation

Escalate SEV1 incidents to the Platform Director after 20 minutes without mitigation.
