import {
  ErrorBodySchema,
  SseDecoder,
  type ChatRequestInput,
  type ChatStreamEvent,
} from "@docs-platform/contracts";

export const SESSION_EXPIRED_MESSAGE = "Your session expired, reload the page to sign in again";
export const RELEASE_UNKNOWN_MESSAGE = "The documentation was updated, reload the page";
export const STREAM_INTERRUPTED_MESSAGE = "The response was interrupted before it finished. Please try again";

/** Typed failure of the chat request or stream. `status` is 0 for non-HTTP failures. */
export class ChatApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(init: { status: number; code: string; message: string; retryAfterSeconds?: number }) {
    super(init.message);
    this.name = "ChatApiError";
    this.status = init.status;
    this.code = init.code;
    if (init.retryAfterSeconds !== undefined) this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

export function createAbortError(): Error {
  return new DOMException("The chat request was aborted", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

export interface StreamChatOptions {
  endpoint: string;
  request: ChatRequestInput;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function sessionError(status: number): ChatApiError {
  return new ChatApiError({ status, code: "SESSION_EXPIRED", message: SESSION_EXPIRED_MESSAGE });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

async function errorFromResponse(response: Response): Promise<ChatApiError> {
  const { status } = response;
  const contentType = response.headers.get("content-type") ?? "";
  if (status === 401 || contentType.includes("text/html")) return sessionError(status);

  let code = "HTTP_ERROR";
  let serverMessage: string | undefined;
  try {
    const parsed = ErrorBodySchema.safeParse(JSON.parse(await response.text()));
    if (parsed.success) {
      code = parsed.data.error.code;
      serverMessage = parsed.data.error.message;
    }
  } catch {
    // Body wasn't JSON; fall through to generic messages.
  }

  if (status === 404 && code === "RELEASE_UNKNOWN") {
    return new ChatApiError({ status, code, message: RELEASE_UNKNOWN_MESSAGE });
  }
  if (status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
    const wait =
      retryAfterSeconds === undefined
        ? "in a moment"
        : `in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}`;
    return new ChatApiError({
      status,
      code: code === "HTTP_ERROR" ? "RATE_LIMITED" : code,
      message: `Too many requests, try again ${wait}`,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }
  return new ChatApiError({
    status,
    code,
    message: serverMessage ?? `The assistant is unavailable (HTTP ${status})`,
  });
}

function interrupted(status: number): ChatApiError {
  return new ChatApiError({
    status,
    code: "STREAM_INTERRUPTED",
    message: STREAM_INTERRUPTED_MESSAGE,
  });
}

/**
 * POSTs a chat request and yields the decoded SSE events. Throws `ChatApiError` for HTTP
 * and stream failures and an `AbortError` when `signal` aborts.
 */
export async function* streamChat(options: StreamChatOptions): AsyncGenerator<ChatStreamEvent> {
  const { endpoint, request, signal } = options;
  const doFetch = options.fetchImpl ?? fetch;
  if (signal?.aborted) throw createAbortError();

  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw createAbortError();
    throw new ChatApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "Couldn't reach the assistant, check your connection and try again",
    });
  }

  if (!response.ok) throw await errorFromResponse(response);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) throw sessionError(response.status);
  if (!response.body) throw interrupted(response.status);

  const reader = response.body.getReader();
  const textDecoder = new TextDecoder();
  const sse = new SseDecoder();
  try {
    for (;;) {
      if (signal?.aborted) throw createAbortError();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw createAbortError();
        throw interrupted(response.status);
      }
      if (signal?.aborted) throw createAbortError();
      if (chunk.done) throw interrupted(response.status);

      let events: ChatStreamEvent[];
      try {
        events = sse.push(textDecoder.decode(chunk.value, { stream: true }));
      } catch {
        events = [{ type: "error", code: "PROTOCOL_ERROR", message: "Malformed stream event" }];
      }
      for (const event of events) {
        yield event;
        if (event.type === "done" || event.type === "error") return;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
