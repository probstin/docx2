---
title: Configuration
sidebar_position: 2
description: Every field of atlas.toml and the environment variables Atlas injects.
---

# Configuration

Each service is configured by an `atlas.toml` file at the repository root.

## Minimal example

```toml
[service]
name = "my-service"
port = 8080

[deploy]
strategy = "rolling"
replicas = 3
```

## Fields

| Field             | Type    | Default   | Description                            |
| ----------------- | ------- | --------- | -------------------------------------- |
| `service.port`    | integer | `8080`    | Port the container listens on          |
| `deploy.replicas` | integer | `2`       | Number of instances, maximum 50        |
| `deploy.strategy` | string  | `rolling` | One of `rolling`, `canary`, `recreate` |
| `deploy.grace`    | integer | `30`      | Seconds to wait before SIGKILL         |

## Deploy strategy {#strategy}

The strategy decides how a new release replaces the old one. See the [deployment guide](./deployment.md) for when to pick each.

## Secrets

Never commit secrets. Store them with `atlasctl secret set NAME`; Atlas injects them as environment variables with the prefix `ATLAS_SECRET_`.

## Injected variables

- `ATLAS_RELEASE_ID`: the ID of the running release.
- `ATLAS_REGION`: always `eu-west-1` today.
- `PORT`: the value of `service.port`.
