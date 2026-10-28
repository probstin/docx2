---
title: CLI reference
sidebar_position: 1
---

# CLI reference

## Global flags

- `--env <name>`: target environment.
- `--json`: machine-readable output.

## Commands

### `atlasctl deploy`

Deploys the current commit. Exits with code `4` when the deploy times out.

### `atlasctl rollback`

Reverts a service to its previous release. Exits with code `5` when no earlier release exists.

### `atlasctl releases`

Lists the last 10 releases of a service.

## Environment variables

`ATLASCTL_TOKEN` overrides the token stored by `atlasctl login`.
