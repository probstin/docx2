import { ChatStreamEventSchema, type ChatStreamEvent } from "./chat.js";

/**
 * SSE framing shared by the API (encoder) and the chat widget (decoder).
 * Each event is `event: <type>\ndata: <json>\n\n`; the JSON carries `type` too, so the
 * `event:` line is informational and the decoder relies on the data alone.
 */
export const SSE_CONTENT_TYPE = "text/event-stream";

export function encodeSseEvent(event: ChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Incremental decoder: feed arbitrary text chunks, receive complete, validated events. */
export class SseDecoder {
  private buffer = "";

  push(chunk: string): ChatStreamEvent[] {
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    const events: ChatStreamEvent[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n\n")) !== -1) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue; // comments / keep-alives
      const parsed = ChatStreamEventSchema.safeParse(JSON.parse(data));
      events.push(
        parsed.success
          ? parsed.data
          : { type: "error", code: "PROTOCOL_ERROR", message: "Malformed stream event" },
      );
    }
    return events;
  }
}
