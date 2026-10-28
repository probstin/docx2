import type { ButtonHTMLAttributes } from "react";
import { CloseIcon, CollapseIcon, ExpandIcon, TrashIcon } from "./icons.js";
import type { ChatMode } from "./types.js";

export interface ChatHeaderProps {
  title: string;
  titleId: string;
  mode: Exclude<ChatMode, "closed">;
  expandable: boolean;
  onToggleExpand: () => void;
  onClear?: () => void;
  onClose: () => void;
}

function IconButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }) {
  return <button type="button" className="dp-chat-icon-button" {...props} />;
}

export function ChatHeader({
  title,
  titleId,
  mode,
  expandable,
  onToggleExpand,
  onClear,
  onClose,
}: ChatHeaderProps) {
  const isFullscreen = mode === "fullscreen";
  return (
    <header className="dp-chat-header">
      <h2 id={titleId} className="dp-chat-title">
        {title}
      </h2>
      <div className="dp-chat-header-actions">
        {expandable ? (
          <IconButton
            aria-label={isFullscreen ? "Exit fullscreen" : "Expand to fullscreen"}
            data-dp-chat-expand=""
            onClick={onToggleExpand}
          >
            {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
          </IconButton>
        ) : null}
        {onClear ? (
          <IconButton aria-label="Clear conversation" onClick={onClear}>
            <TrashIcon />
          </IconButton>
        ) : null}
        <IconButton aria-label="Close chat" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
    </header>
  );
}
