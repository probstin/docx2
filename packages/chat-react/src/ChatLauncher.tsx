import { ChatIcon } from "./icons.js";

export interface ChatLauncherProps {
  /** Accessible name, e.g. "Open Ask Engineering AI". */
  label: string;
  onOpen: () => void;
}

export function ChatLauncher({ label, onOpen }: ChatLauncherProps) {
  return (
    <button
      type="button"
      className="dp-chat-launcher"
      aria-label={label}
      data-dp-chat-launcher=""
      onClick={onOpen}
    >
      <ChatIcon />
    </button>
  );
}
