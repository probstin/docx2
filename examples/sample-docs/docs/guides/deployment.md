---
title: Deployment guide
sidebar_position: 1
description: Deploy, promote and roll back services on Atlas.
---

# Deployment guide

Atlas supports three environments: `dev`, `staging` and `production`. Production deploys require a green staging deploy of the same commit.

## Deploying a service

Run the deploy command from the service directory:

```bash
atlasctl deploy --env production --wait
```

The `--wait` flag blocks until the release is healthy. The default deploy timeout is **600 seconds**; override it with `--timeout`.

## Release strategies

| Strategy   | Behaviour                                     | When to use it            |
| ---------- | --------------------------------------------- | ------------------------- |
| `rolling`  | Replaces instances 25% at a time              | Default for most services |
| `canary`   | Sends 5% of traffic to the new release first  | Risky changes             |
| `recreate` | Stops everything, then starts the new release | Singleton workloads       |

Set the strategy in `atlas.toml`, as described in [Configuration](./configuration.md#strategy).

## Rolling back {#rollback}

To return to the previous release, run:

```bash
atlasctl rollback my-service --env production
```

A rollback completes in about **90 seconds**. To pick a specific release, pass `--to <release-id>`; list candidates with `atlasctl releases my-service`.

Only the last 10 releases are available; see [data retention](../architecture/overview.md#data-retention).

## Rolling back the database {#rollback-database}

Database migrations are **not** reverted by `atlasctl rollback`. Run `atlasctl migrate down --steps 1` first, and ask the on-call engineer for a second pair of eyes.

## Freeze windows

Production deploys are blocked during the freeze window, **Friday 16:00 to Monday 06:00 UTC**. Emergency deploys need the `--break-glass` flag and an incident ticket.
