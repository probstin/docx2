import { useCallback, useState } from "react";
import { loadMode, saveMode } from "./session-store.js";
import type { ChatMode } from "./types.js";

/** `ChatMode` persisted in sessionStorage (under `<storageKey>:mode`). */
export function useChatMode(storageKey: string): [ChatMode, (mode: ChatMode) => void] {
  const key = `${storageKey}:mode`;
  const [mode, setModeState] = useState<ChatMode>(() => loadMode(key));
  const setMode = useCallback(
    (next: ChatMode) => {
      setModeState(next);
      saveMode(key, next);
    },
    [key],
  );
  return [mode, setMode];
}
