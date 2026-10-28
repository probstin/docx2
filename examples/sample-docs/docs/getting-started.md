---
title: Getting started
sidebar_position: 2
description: Install the Atlas CLI and deploy your first service in about ten minutes.
---

# Getting started

This page walks you from zero to a running service. You need membership of the `atlas-users` group.

## Install the CLI

The CLI is called `atlasctl`. The current stable release is **4.12.0**.

```bash
curl -fsSL https://get.atlas.northwind.example/install.sh | sh
atlasctl version
```

Authenticate once with `atlasctl login`. Tokens are valid for 12 hours.

## Create a service

Scaffold a service from a template:

```bash
atlasctl init my-service --template go-http
cd my-service
```

This creates an `atlas.toml` file next to your code. See [Configuration](./guides/configuration.md) for every field.

## Your first deploy

```bash
atlasctl deploy --env staging
```

The first deploy usually finishes in under 3 minutes. If it fails, run `atlasctl logs --build` and compare the output with the [troubleshooting checklist](./guides/oncall.md#troubleshooting).

## Next steps

Read the [architecture overview](./architecture/overview.md) to learn what happened behind the scenes.
