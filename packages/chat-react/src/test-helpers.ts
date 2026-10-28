import { encodeSseEvent, type ChatStreamEvent } from "@docs-platform/contracts";

export const RELEASE = "20260101000000-abcdef1";

/** Encodes events and splits the text at awkward boundaries (mid-frame, mid-JSON). */
export function sseChunks(events: ChatStreamEvent[], size = 7): string[] {
  const text = events.map(encodeSseEvent).join("");
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export interface ControlledStream {
  response: Response;
  push(chunk: string): void;
  close(): void;
}

/** A streaming response the test feeds manually; errors with AbortError on abort. */
export function controlledStream(signal?: AbortSignal | null): ControlledStream {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      signal?.addEventListener("abort", () => {
        try {
          c.error(new DOMException("aborted", "AbortError"));
        } catch {
          // already closed
        }
      });
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    push: (chunk) => controller.enqueue(encoder.encode(chunk)),
    close: () => controller.close(),
  };
}

export function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(encoder.encode(chunk));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export function jsonError(status: number, code: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { code, message: "server text" } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export const CITATION = {
  index: 1,
  title: "Deployment",
  url: "/docs/guides/deployment#rollback",
  heading: "Rollback",
  sourcePath: "docs/guides/deployment.md",
  releaseId: RELEASE,
};

export const okEvents: ChatStreamEvent[] = [
  { type: "start", messageId: "srv1" },
  { type: "delta", text: "Hello " },
  { type: "delta", text: "world" },
  { type: "citations", sources: [CITATION] },
  { type: "done", status: "grounded" },
];
