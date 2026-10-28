import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Citation } from "@docs-platform/contracts";
import { ChatShell, type ChatMode, type UiMessage } from "../src/index.js";
import "../src/styles.css";

// Static harness for trying the chat UI by hand. Nothing here talks to a server:
// answers are canned and streamed word by word with setTimeout.

const RELEASE_ID = "20261027120000-abcdef1";

const CANNED_ANSWER = [
  "To roll back, open the releases list and activate a previous release.",
  "The platform keeps the last few revisions, so the site and its matching search index are restored together.",
  "",
  "Rollbacks never pair a site revision with the wrong index.",
].join("\n");

const CANNED_DECLINE =
  "I could not find this in the documentation. Try rephrasing the question or check the Deployment guide.";

const CITATIONS: Citation[] = [
  {
    index: 1,
    title: "Deployment",
    url: "/docs/guides/deployment#rollback",
    heading: "Rollback",
    anchor: "rollback",
    sourcePath: "docs/guides/deployment.md",
    releaseId: RELEASE_ID,
  },
  {
    index: 2,
    title: "Architecture",
    url: "/docs/architecture/overview#releases",
    heading: "Releases",
    anchor: "releases",
    sourcePath: "docs/architecture/overview.md",
    releaseId: RELEASE_ID,
  },
];

const STEP_MS = 60;
const ERROR_AFTER_TOKENS = 6;

function App() {
  const [mode, setMode] = useState<ChatMode>("closed");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [simulateError, setSimulateError] = useState(false);
  const [simulateInsufficient, setSimulateInsufficient] = useState(false);
  const [dark, setDark] = useState(false);

  const timers = useRef<number[]>([]);
  const nextId = useRef(0);
  const isStreaming = messages.some((message) => message.status === "streaming");

  const clearTimers = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  useEffect(() => clearTimers, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  const updateMessage = (id: string, patch: (message: UiMessage) => UiMessage) =>
    setMessages((previous) => previous.map((message) => (message.id === id ? patch(message) : message)));

  const streamAnswer = (assistantId: string) => {
    clearTimers();
    const insufficient = simulateInsufficient;
    const tokens = (insufficient ? CANNED_DECLINE : CANNED_ANSWER).split(/(?<=\s)/);
    const failAt = simulateError ? ERROR_AFTER_TOKENS : -1;

    updateMessage(assistantId, (message) => ({
      ...message,
      content: "",
      status: "streaming",
      errorMessage: undefined,
      citations: undefined,
      answerStatus: undefined,
    }));

    const step = (index: number) => {
      if (index === failAt) {
        updateMessage(assistantId, (message) => ({
          ...message,
          status: "error",
          errorMessage: "The assistant could not reach the model. Please try again.",
        }));
        return;
      }
      if (index >= tokens.length) {
        updateMessage(assistantId, (message) => ({
          ...message,
          status: "complete",
          answerStatus: insufficient ? "insufficient_context" : "grounded",
          citations: insufficient ? undefined : CITATIONS,
        }));
        return;
      }
      const token = tokens[index] ?? "";
      updateMessage(assistantId, (message) => ({ ...message, content: message.content + token }));
      timers.current.push(window.setTimeout(() => step(index + 1), STEP_MS));
    };

    timers.current.push(window.setTimeout(() => step(0), STEP_MS * 3));
  };

  const handleSend = (text: string) => {
    nextId.current += 1;
    const userId = `user-${nextId.current}`;
    const assistantId = `assistant-${nextId.current}`;
    setMessages((previous) => [
      ...previous,
      { id: userId, role: "user", content: text, status: "complete" },
      { id: assistantId, role: "assistant", content: "", status: "streaming" },
    ]);
    streamAnswer(assistantId);
  };

  const handleRetry = (messageId: string) => {
    const index = messages.findIndex((message) => message.id === messageId);
    const question = messages
      .slice(0, Math.max(index, 0))
      .reverse()
      .find((message) => message.role === "user");
    if (!question) return;
    streamAnswer(messageId);
  };

  const handleCancel = () => {
    clearTimers();
    setMessages((previous) =>
      previous.map((message) =>
        message.status === "streaming" ? { ...message, status: "cancelled" } : message,
      ),
    );
  };

  const handleClear = () => {
    clearTimers();
    setMessages([]);
  };

  return (
    <main className="demo-page">
      <h1>Chat UI demo</h1>
      <p>
        Try the launcher, panel, and fullscreen modes. Your draft and the conversation should survive
        switching modes. Escape steps back from fullscreen, then closes the panel.
      </p>
      <div className="demo-toolbar">
        <label>
          <input
            type="checkbox"
            checked={simulateError}
            onChange={(event) => setSimulateError(event.target.checked)}
          />
          Simulate error (stream fails mid-answer)
        </label>
        <label>
          <input
            type="checkbox"
            checked={simulateInsufficient}
            onChange={(event) => setSimulateInsufficient(event.target.checked)}
          />
          Simulate insufficient_context
        </label>
        <label>
          <input type="checkbox" checked={dark} onChange={(event) => setDark(event.target.checked)} />
          Dark theme (via data-theme)
        </label>
      </div>

      <ChatShell
        mode={mode}
        onModeChange={setMode}
        messages={messages}
        isStreaming={isStreaming}
        onSend={handleSend}
        onCancel={handleCancel}
        onRetry={handleRetry}
        onClear={handleClear}
        title="Ask Engineering AI"
        welcomeMessage="Ask a question about the documentation."
        pageContext={{ title: "Deployment", heading: "Rollback", url: "/docs/guides/deployment#rollback" }}
        expandable
        suggestions={["How do I roll back a release?", "What does the index contain?"]}
      />
    </main>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
