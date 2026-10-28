import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { embedText } from "./embed.js";

export interface MockOpenAIOptions {
  /** 0 picks a free port. */
  port?: number;
  host?: string;
  /** Overrides MOCK_OPENAI_API_KEY. */
  apiKey?: string;
  /** Overrides MOCK_EMBEDDINGS_DIMENSIONS (default 1024). */
  dimensions?: number;
  /** Overrides MOCK_OPENAI_DELAY_MS (default 5). */
  delayMs?: number;
}

export interface MockOpenAI {
  url: string;
  close(): Promise<void>;
}

export const DECLINE_SENTENCE = "I could not find that in the provided documentation.";
const MAX_BODY = 8 * 1024 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

function error(res: ServerResponse, status: number, message: string): void {
  json(res, status, { error: { message, type: "invalid_request_error" } });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("request body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""))
      .join("\n");
  }
  return "";
}

/** The grounded answer: first one or two sentences of the first `<source>` block, cited as [1]. */
export function composeAnswer(messages: { role?: string; content?: unknown }[]): string {
  const prompt = messages
    .filter((m) => m.role !== "system")
    .map((m) => contentText(m.content))
    .join("\n");
  const match = /<source\b[^>]*>([\s\S]*?)<\/source>/.exec(prompt);
  if (!match) return DECLINE_SENTENCE;
  const text = (match[1] ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[|#*`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return DECLINE_SENTENCE;
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join(" ");
  const clipped = sentences.length > 400 ? `${sentences.slice(0, 400).trimEnd()}...` : sentences;
  return `${clipped} [1]`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function startMockOpenAI(options: MockOpenAIOptions = {}): Promise<MockOpenAI> {
  const apiKey = options.apiKey ?? process.env.MOCK_OPENAI_API_KEY ?? "";
  const defaultDims = options.dimensions ?? (Number(process.env.MOCK_EMBEDDINGS_DIMENSIONS) || 1024);
  const delayMs =
    options.delayMs ??
    (process.env.MOCK_OPENAI_DELAY_MS !== undefined ? Number(process.env.MOCK_OPENAI_DELAY_MS) : 5);

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) error(res, 400, e instanceof Error ? e.message : "bad request");
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "").split("?")[0];
    if (apiKey && req.headers.authorization !== `Bearer ${apiKey}`) {
      return error(res, 401, "Incorrect API key provided");
    }
    if (req.method === "GET" && path === "/v1/models") {
      return json(res, 200, {
        object: "list",
        data: ["mock-chat", "mock-embeddings"].map((id) => ({
          id,
          object: "model",
          created: 0,
          owned_by: "mock-openai",
        })),
      });
    }
    if (req.method === "POST" && path === "/v1/embeddings") {
      const body = (await readJson(req)) as { input?: unknown; dimensions?: unknown; model?: unknown };
      const inputs = typeof body.input === "string" ? [body.input] : body.input;
      if (!Array.isArray(inputs) || !inputs.every((i) => typeof i === "string")) {
        return error(res, 400, "input must be a string or an array of strings");
      }
      const dims =
        typeof body.dimensions === "number" && Number.isInteger(body.dimensions) && body.dimensions > 0
          ? body.dimensions
          : defaultDims;
      const tokens = (inputs as string[]).reduce((n, s) => n + s.split(/\s+/).filter(Boolean).length, 0);
      return json(res, 200, {
        object: "list",
        model: typeof body.model === "string" ? body.model : "mock-embeddings",
        data: (inputs as string[]).map((s, index) => ({
          object: "embedding",
          index,
          embedding: embedText(s, dims),
        })),
        usage: { prompt_tokens: tokens, total_tokens: tokens },
      });
    }
    if (req.method === "POST" && path === "/v1/chat/completions") {
      const body = (await readJson(req)) as { messages?: unknown; stream?: unknown; model?: unknown };
      if (!Array.isArray(body.messages)) return error(res, 400, "messages must be an array");
      const model = typeof body.model === "string" ? body.model : "mock-chat";
      const answer = composeAnswer(body.messages as { role?: string; content?: unknown }[]);
      const id = `chatcmpl-mock-${Date.now().toString(36)}`;
      const created = Math.floor(Date.now() / 1000);
      if (body.stream !== true) {
        const words = answer.split(/\s+/).length;
        return json(res, 200, {
          id,
          object: "chat.completion",
          created,
          model,
          choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: words, total_tokens: words },
        });
      }
      let closed = false;
      res.on("close", () => {
        closed = true;
      });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (delta: Record<string, unknown>, finish: string | null): void => {
        const chunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      };
      send({ role: "assistant", content: "" }, null);
      const pieces = answer.match(/\S+\s*/g) ?? [];
      for (const piece of pieces) {
        if (closed) return;
        send({ content: piece }, null);
        if (delayMs > 0) await sleep(delayMs);
      }
      if (closed) return;
      send({}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    error(res, 404, `unknown route ${req.method} ${path}`);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${options.host ?? "127.0.0.1"}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
