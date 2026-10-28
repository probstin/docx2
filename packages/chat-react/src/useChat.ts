import { CHAT_LIMITS, type ChatHistoryMessage, type ChatRequestInput } from "@docs-platform/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatApiError, isAbortError, streamChat } from "./api-client.js";
import { clearSession, createSessionWriter, loadSession, saveSession } from "./session-store.js";
import type { PageContextInfo, UiMessage } from "./types.js";

export interface UseChatOptions {
  endpoint: string;
  releaseId: string;
  getPageContext: () => PageContextInfo;
  /** sessionStorage key; should include the site basePath. */
  storageKey: string;
  /** Max history messages sent per request (default and ceiling: the contract limit). */
  historyLimit?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export interface UseChatResult {
  messages: UiMessage[];
  isStreaming: boolean;
  send: (text: string) => void;
  cancel: () => void;
  retry: (messageId: string) => void;
  clear: () => void;
}

let idCounter = 0;
function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  idCounter += 1;
  return `m-${Date.now().toString(36)}-${idCounter}`;
}

/** Schedules a callback on the next frame, falling back to a timer where rAF is missing. */
function scheduleFrame(cb: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const handle = requestAnimationFrame(cb);
    return () => cancelAnimationFrame(handle);
  }
  const handle = setTimeout(cb, 16);
  return () => clearTimeout(handle);
}

/**
 * Builds the request history from messages preceding the new user turn: complete
 * user/assistant pairs only (a failed or cancelled assistant turn drops its user message
 * too, keeping roles alternating), newest `limit` kept, content clipped to contract limits.
 */
export function buildHistory(messages: UiMessage[], limit: number): ChatHistoryMessage[] {
  const max = Math.max(0, Math.min(limit, CHAT_LIMITS.historyMaxMessages));
  const turns: ChatHistoryMessage[][] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const user = messages[i];
    const assistant = messages[i + 1];
    if (user?.role !== "user") continue;
    if (assistant?.role === "assistant") {
      i += 1;
      if (user.status !== "complete" || assistant.status !== "complete") continue;
      if (!user.content.trim() || !assistant.content.trim()) continue;
      turns.push([
        { role: "user", content: user.content },
        { role: "assistant", content: assistant.content },
      ]);
    }
  }
  const flat = turns.flat().map((m) => ({
    role: m.role,
    content: m.content.slice(0, CHAT_LIMITS.historyMessageMaxChars),
  }));
  return max === 0 ? [] : flat.slice(-max);
}

export function useChat(options: UseChatOptions): UseChatResult {
  const { storageKey } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const messagesRef = useRef<UiMessage[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>(() => {
    const stored = loadSession(storageKey);
    let loaded = stored?.messages ?? [];
    if (stored && stored.releaseId !== options.releaseId) {
      // Citations may point at anchors the new release no longer has, and the old turns are not
      // context for it: start fresh and overwrite the stored session.
      loaded = [];
      saveSession(storageKey, { releaseId: options.releaseId, messages: [] });
    }
    messagesRef.current = loaded;
    return loaded;
  });
  const [isStreaming, setIsStreaming] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const pendingDeltaRef = useRef("");
  const cancelFrameRef = useRef<(() => void) | null>(null);

  const commit = useCallback((next: UiMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const patch = useCallback(
    (id: string, fn: (m: UiMessage) => UiMessage) => {
      commit(messagesRef.current.map((m) => (m.id === id ? fn(m) : m)));
    },
    [commit],
  );

  const flushDeltas = useCallback(() => {
    cancelFrameRef.current?.();
    cancelFrameRef.current = null;
    const text = pendingDeltaRef.current;
    const id = activeIdRef.current;
    pendingDeltaRef.current = "";
    if (text && id) patch(id, (m) => ({ ...m, content: m.content + text }));
  }, [patch]);

  const queueDelta = useCallback(
    (text: string) => {
      pendingDeltaRef.current += text;
      cancelFrameRef.current ??= scheduleFrame(() => {
        cancelFrameRef.current = null;
        flushDeltas();
      });
    },
    [flushDeltas],
  );

  // Persistence: debounced writes; flush on unmount.
  const writer = useMemo(() => createSessionWriter(storageKey), [storageKey]);
  useEffect(() => {
    writer.schedule({ releaseId: optionsRef.current.releaseId, messages });
  }, [writer, messages]);
  useEffect(() => () => writer.flush(), [writer]);

  // Abort anything in flight on unmount.
  useEffect(
    () => () => {
      cancelFrameRef.current?.();
      cancelFrameRef.current = null;
      controllerRef.current?.abort();
    },
    [],
  );

  const run = useCallback(
    async (userText: string, base: UiMessage[], assistantIndex: number | null) => {
      const opts = optionsRef.current;
      const text = userText.slice(0, CHAT_LIMITS.messageMaxChars);
      const userMessage: UiMessage = { id: newId(), role: "user", content: text, status: "complete" };
      const assistant: UiMessage = {
        id: newId(),
        role: "assistant",
        content: "",
        status: "streaming",
      };
      const history = buildHistory(base, opts.historyLimit ?? CHAT_LIMITS.historyMaxMessages);
      let next: UiMessage[];
      if (assistantIndex === null) {
        next = [...base, userMessage, assistant];
      } else {
        // Retry: keep the existing user message, replace the failed assistant in place.
        const rest = messagesRef.current.slice(assistantIndex + 1);
        const existingUser = messagesRef.current[assistantIndex - 1];
        next = [...base, existingUser ?? userMessage, assistant, ...rest];
      }

      const page = opts.getPageContext();
      const context: ChatRequestInput["context"] = {
        releaseId: opts.releaseId,
        pageUrl: page.url.slice(0, 2048),
        ...(page.title ? { pageTitle: page.title.slice(0, 300) } : {}),
        ...(page.heading ? { heading: page.heading.slice(0, 300) } : {}),
      };

      const controller = new AbortController();
      controllerRef.current = controller;
      activeIdRef.current = assistant.id;
      pendingDeltaRef.current = "";
      commit(next);
      setIsStreaming(true);

      const id = assistant.id;
      try {
        const stream = streamChat({
          endpoint: opts.endpoint,
          request: { message: text, history, context },
          signal: controller.signal,
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        });
        for await (const event of stream) {
          if (event.type === "delta") {
            queueDelta(event.text);
          } else if (event.type === "citations") {
            flushDeltas();
            patch(id, (m) => ({ ...m, citations: event.sources }));
          } else if (event.type === "done") {
            flushDeltas();
            patch(id, (m) => ({ ...m, status: "complete", answerStatus: event.status }));
          } else if (event.type === "error") {
            flushDeltas();
            patch(id, (m) => ({ ...m, status: "error", errorMessage: event.message }));
          }
        }
      } catch (error) {
        if (isAbortError(error)) {
          flushDeltas();
          patch(id, (m) => (m.status === "streaming" ? { ...m, status: "cancelled" } : m));
        } else {
          flushDeltas();
          const message =
            error instanceof ChatApiError ? error.message : "Something went wrong, please try again";
          patch(id, (m) => ({ ...m, status: "error", errorMessage: message }));
        }
      } finally {
        if (activeIdRef.current === id) {
          flushDeltas();
          activeIdRef.current = null;
          controllerRef.current = null;
          setIsStreaming(false);
        }
      }
    },
    [commit, patch, queueDelta, flushDeltas],
  );

  const send = useCallback(
    (text: string) => {
      if (controllerRef.current || !text.trim()) return;
      void run(text, messagesRef.current, null);
    },
    [run],
  );

  const retry = useCallback(
    (messageId: string) => {
      if (controllerRef.current) return;
      const current = messagesRef.current;
      const index = current.findIndex((m) => m.id === messageId);
      const target = current[index];
      const user = current[index - 1];
      if (index < 1 || target?.role !== "assistant" || user?.role !== "user") return;
      void run(user.content, current.slice(0, index - 1), index);
    },
    [run],
  );

  const cancel = useCallback(() => {
    const controller = controllerRef.current;
    const id = activeIdRef.current;
    if (!controller || !id) return;
    flushDeltas();
    patch(id, (m) => (m.status === "streaming" ? { ...m, status: "cancelled" } : m));
    controller.abort();
  }, [flushDeltas, patch]);

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    activeIdRef.current = null;
    cancelFrameRef.current?.();
    cancelFrameRef.current = null;
    pendingDeltaRef.current = "";
    setIsStreaming(false);
    writer.cancel();
    clearSession(storageKey);
    commit([]);
  }, [commit, storageKey, writer]);

  return { messages, isStreaming, send, cancel, retry, clear };
}
