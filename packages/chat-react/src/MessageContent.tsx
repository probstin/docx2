export interface MessageContentProps {
  text: string;
}

/**
 * Renders assistant/user message text. Currently plain text with preserved line breaks.
 * This is the single seam where Markdown rendering is swapped in later.
 */
export function MessageContent({ text }: MessageContentProps) {
  return <div className="dp-chat-message-content">{text}</div>;
}
