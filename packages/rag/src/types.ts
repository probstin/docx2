/** Minimal pino-compatible logger (`log.info({ fields }, "message")`). Never log secrets or prompts. */
export interface Logger {
  debug(fields: object, msg: string): void;
  info(fields: object, msg: string): void;
  warn(fields: object, msg: string): void;
  error(fields: object, msg: string): void;
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface EmbeddingsClient {
  embedDocuments(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  embedQuery(text: string, signal?: AbortSignal): Promise<number[]>;
}

export interface ChatModelClient {
  /** Yields answer text deltas. Must stop (by throwing or returning) when `signal` aborts. */
  stream(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string>;
}

/** What a page-aware request knows about where the user is. All of it is untrusted metadata. */
export interface PageContext {
  /** Site route or absolute URL of the page the user is reading. */
  pageUrl?: string;
  pageTitle?: string;
  heading?: string;
  /** Anchor (without `#`) of the section the user is reading, if known. */
  anchor?: string;
}

export interface Chunk {
  /** Position within the document, starting at 0. */
  ordinal: number;
  /** Text of the section heading; undefined for the intro before the first heading. */
  heading?: string;
  /** Docusaurus anchor of that heading; undefined for the intro. */
  anchor?: string;
  /** e.g. `Deployment guide › Rolling back`. */
  headingPath: string;
  /** Clean content as stored and shown to the model. */
  content: string;
  /** Content prefixed with the doc title and heading path; what gets embedded. */
  embedText: string;
}
