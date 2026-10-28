# 0004 — Chat over SSE-framed POST with client-held history

**Status:** Accepted (Wave 0)

## Decision

- `POST /api/v1/chat` with a JSON `ChatRequest` returns `text/event-stream`. Events are `ChatStreamEvent`s, framed by the shared `encodeSseEvent`/`SseDecoder` in contracts. The browser uses `fetch` plus a `ReadableStream` reader rather than `EventSource` (which can't POST), and cancels with an `AbortController`. The server aborts the upstream model call when the client disconnects.
- Event order: `start` → `delta`* → `citations` → `done{status}`. An `error` may replace any remaining events. `done.status = "insufficient_context"` marks the explicit decline when retrieval falls below `RETRIEVAL_MIN_SCORE`.
- Conversation history stays in the browser (session storage). The client sends up to 20 recent messages, and the server trims further to fit its prompt budget. There's no server-side chat persistence in the MVP.
- `context.releaseId` comes from the generated site (`customFields.releaseId`). The API rejects it with `RELEASE_UNKNOWN` unless the release is `ACTIVE` or `INACTIVE`. `pageUrl` must belong to `PLATFORM_PUBLIC_URL`. Page title and heading only boost ranking; they never filter.
- Retrieved content and page context are inserted into the prompt as delimited, untrusted data, never as system instructions.
