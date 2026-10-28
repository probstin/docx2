---
description: Hard limits enforced by Atlas.
---

# Platform limits

Atlas enforces the following hard limits per service:

| Limit                 | Value  |
| --------------------- | ------ |
| Replicas              | 50     |
| Container image size  | 4 GiB  |
| Environment variables | 128    |
| Request body size     | 10 MiB |

Exceeding the image size limit fails the build with error `ATL-1042`.

## Request timeouts

The Gateway closes idle connections after **60 seconds** and aborts requests that run longer than **120 seconds**.
