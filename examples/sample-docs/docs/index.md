---
title: Atlas Platform
sidebar_position: 1
description: Landing page for the Atlas internal deployment platform.
---

# Atlas Platform

Atlas is the internal platform that builds, deploys and runs every production service at Northwind. This site is the single source of truth for how to use it.

## What Atlas does {#what-atlas-does}

Atlas takes a service from a source commit to a running, observable workload:

- It builds a container image with the **Forge** build service.
- It schedules the release onto a cluster with the **Scheduler**.
- It routes traffic through the **Gateway**, which listens on port `8443`.

## Where to go next

| You want to...               | Read                                                |
| ---------------------------- | --------------------------------------------------- |
| Ship your first service      | [Getting started](./getting-started.md)             |
| Understand the components    | [Architecture overview](./architecture/overview.md) |
| Deploy or roll back a change | [Deployment guide](./guides/deployment.md)          |
| Be on call for Atlas         | [On-call handbook](./guides/oncall.md)              |

If something is broken right now, jump straight to [rolling back](./guides/deployment.md#rollback).
