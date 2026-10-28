// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionWriter,
  loadMode,
  loadSession,
  MAX_STORED_MESSAGES,
  saveMode,
  saveSession,
} from "./session-store.js";
import type { UiMessage } from "./types.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const msg = (id: string, status: UiMessage["status"] = "complete"): UiMessage => ({
  id,
  role: "assistant",
  content: id,
  status,
});

describe("session-store", () => {
  it("round-trips and converts stale streaming to cancelled", () => {
    saveSession("k", { releaseId: "r1", messages: [msg("a"), msg("b", "streaming")] });
    const loaded = loadSession("k");
    expect(loaded?.releaseId).toBe("r1");
    expect(loaded?.messages.map((m) => m.status)).toEqual(["complete", "cancelled"]);
  });

  it("caps stored messages to the newest ones", () => {
    const many = Array.from({ length: MAX_STORED_MESSAGES + 10 }, (_, i) => msg(`m${i}`));
    saveSession("k", { messages: many });
    const loaded = loadSession("k")!;
    expect(loaded.messages).toHaveLength(MAX_STORED_MESSAGES);
    expect(loaded.messages.at(-1)?.id).toBe(`m${MAX_STORED_MESSAGES + 9}`);
  });

  it("ignores corrupt data", () => {
    sessionStorage.setItem("k", "{not json");
    expect(loadSession("k")).toBeNull();
    sessionStorage.setItem("k", JSON.stringify({ v: 2 }));
    expect(loadSession("k")).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(loadSession("k")).toBeNull();
    expect(() => saveSession("k", { messages: [msg("a")] })).not.toThrow();
    expect(loadMode("k")).toBe("closed");
    expect(() => saveMode("k", "panel")).not.toThrow();
  });

  it("debounces writes", () => {
    vi.useFakeTimers();
    const w = createSessionWriter("k", 100);
    w.schedule({ messages: [msg("a")] });
    w.schedule({ messages: [msg("a"), msg("b")] });
    expect(sessionStorage.getItem("k")).toBeNull();
    vi.advanceTimersByTime(100);
    expect(loadSession("k")?.messages).toHaveLength(2);
  });

  it("persists mode and rejects junk", () => {
    saveMode("m", "fullscreen");
    expect(loadMode("m")).toBe("fullscreen");
    sessionStorage.setItem("m", "bogus");
    expect(loadMode("m")).toBe("closed");
  });
});
