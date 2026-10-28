import { CitationSchema } from "@docs-platform/contracts";
import { z } from "zod";
import type { ChatMode, UiMessage } from "./types.js";

export const MAX_STORED_MESSAGES = 50;
export const WRITE_DEBOUNCE_MS = 300;

const StoredMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  status: z.enum(["streaming", "complete", "error", "cancelled"]),
  citations: z.array(CitationSchema).optional(),
  answerStatus: z.enum(["grounded", "insufficient_context"]).optional(),
  errorMessage: z.string().optional(),
});

const StoredSessionSchema = z.object({
  v: z.literal(1),
  releaseId: z.string().optional(),
  messages: z.array(StoredMessageSchema),
});

export interface StoredSession {
  releaseId?: string;
  messages: UiMessage[];
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Loads the persisted conversation. A message left `streaming` is restored as `cancelled`. */
export function loadSession(key: string): StoredSession | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const parsed = StoredSessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const messages: UiMessage[] = parsed.data.messages.map((m) =>
      m.status === "streaming" ? { ...m, status: "cancelled" } : m,
    );
    return { ...(parsed.data.releaseId ? { releaseId: parsed.data.releaseId } : {}), messages };
  } catch {
    return null;
  }
}

export function saveSession(key: string, session: StoredSession): void {
  try {
    const payload = {
      v: 1,
      ...(session.releaseId ? { releaseId: session.releaseId } : {}),
      messages: session.messages.slice(-MAX_STORED_MESSAGES),
    };
    storage()?.setItem(key, JSON.stringify(payload));
  } catch {
    // Storage unavailable or full: the widget keeps working in memory.
  }
}

export function clearSession(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
}

export interface SessionWriter {
  schedule(session: StoredSession): void;
  flush(): void;
  cancel(): void;
}

/** Debounced writer; `flush` writes any pending value immediately. */
export function createSessionWriter(key: string, delayMs = WRITE_DEBOUNCE_MS): SessionWriter {
  let pending: StoredSession | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    clearTimer();
    if (!pending) return;
    const value = pending;
    pending = null;
    saveSession(key, value);
  };
  return {
    schedule(session) {
      pending = session;
      clearTimer();
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel() {
      clearTimer();
      pending = null;
    },
  };
}

const MODES: readonly ChatMode[] = ["closed", "panel", "fullscreen"];

export function loadMode(key: string): ChatMode {
  try {
    const raw = storage()?.getItem(key);
    return MODES.find((m) => m === raw) ?? "closed";
  } catch {
    return "closed";
  }
}

export function saveMode(key: string, mode: ChatMode): void {
  try {
    storage()?.setItem(key, mode);
  } catch {
    // ignore
  }
}
