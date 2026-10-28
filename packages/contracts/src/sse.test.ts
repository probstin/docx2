import { describe, expect, it } from "vitest";
import type { ChatStreamEvent } from "./chat.js";
import { SseDecoder, encodeSseEvent } from "./sse.js";

const releaseId = "20261027120000-abcdef123456";

describe("SSE framing", () => {
  it("round-trips events across arbitrary chunk boundaries", () => {
    const events: ChatStreamEvent[] = [
      { type: "start", messageId: "m1" },
      { type: "delta", text: "Hello\n\nworld" },
      {
        type: "citations",
        sources: [
          {
            index: 1,
            title: "Deploy",
            url: "/docs/deploy#rollback",
            sourcePath: "docs/deploy.md",
            releaseId,
          },
        ],
      },
      { type: "done", status: "grounded" },
    ];
    const wire = events.map(encodeSseEvent).join("");
    const decoder = new SseDecoder();
    const out: ChatStreamEvent[] = [];
    for (let i = 0; i < wire.length; i += 7) out.push(...decoder.push(wire.slice(i, i + 7)));
    expect(out).toEqual(events);
  });

  it("ignores comments and reports malformed events as protocol errors", () => {
    const decoder = new SseDecoder();
    expect(decoder.push(": keep-alive\n\n")).toEqual([]);
    expect(decoder.push('data: {"type":"bogus"}\n\n')).toEqual([
      { type: "error", code: "PROTOCOL_ERROR", message: "Malformed stream event" },
    ]);
  });

  it("handles CRLF line endings", () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: {"type":"done","status":"insufficient_context"}\r\n\r\n')).toEqual([
      { type: "done", status: "insufficient_context" },
    ]);
  });
});
