// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatShell } from "./ChatShell.js";
import type { ChatMode, UiMessage } from "./types.js";

afterEach(cleanup);

const TITLE = "Ask Engineering AI";

interface HarnessProps {
  initialMode?: ChatMode;
  messages?: UiMessage[];
  isStreaming?: boolean;
  expandable?: boolean;
  onSend?: (text: string) => void;
  onCancel?: () => void;
}

/** Controlled host, like a real page would be: owns the mode, passes everything else in. */
function Harness({
  initialMode = "closed",
  messages = [],
  isStreaming = false,
  expandable = true,
  onSend = () => {},
  onCancel = () => {},
}: HarnessProps) {
  const [mode, setMode] = useState<ChatMode>(initialMode);
  return (
    <ChatShell
      mode={mode}
      onModeChange={setMode}
      messages={messages}
      isStreaming={isStreaming}
      onSend={onSend}
      onCancel={onCancel}
      title={TITLE}
      welcomeMessage="How can I help?"
      suggestions={["How do I roll back?"]}
      expandable={expandable}
      pageContext={{ title: "Deployment", heading: "Rollback", url: "/docs/guides/deployment#rollback" }}
    />
  );
}

const earlier: UiMessage = {
  id: "a1",
  role: "assistant",
  content: "Earlier answer text",
  status: "complete",
};

describe("ChatShell modes", () => {
  it("renders only the launcher when closed", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: `Open ${TITLE}` })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: TITLE })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("focuses the composer when opened from the launcher", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: `Open ${TITLE}` }));
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("renders a log region with polite live updates", () => {
    render(<Harness initialMode="panel" messages={[earlier]} />);
    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Earlier answer text")).toBeInTheDocument();
  });

  it("fullscreen is a modal dialog labelled by the title", async () => {
    const user = userEvent.setup();
    render(<Harness initialMode="panel" />);
    await user.click(screen.getByRole("button", { name: "Expand to fullscreen" }));
    const dialog = screen.getByRole("dialog", { name: TITLE });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("omits the fullscreen toggle when not expandable", () => {
    render(<Harness initialMode="panel" expandable={false} />);
    expect(screen.queryByRole("button", { name: "Expand to fullscreen" })).toBeNull();
  });

  it("keeps messages and the unsent draft across panel -> fullscreen -> panel", async () => {
    const user = userEvent.setup();
    render(<Harness initialMode="panel" messages={[earlier]} />);

    await user.type(screen.getByRole("textbox"), "unsent draft");
    await user.click(screen.getByRole("button", { name: "Expand to fullscreen" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Earlier answer text")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("unsent draft");

    await user.click(screen.getByRole("button", { name: "Exit fullscreen" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Earlier answer text")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("unsent draft");
  });

  it("returns focus to the expand control when leaving fullscreen", async () => {
    const user = userEvent.setup();
    render(<Harness initialMode="panel" />);
    await user.click(screen.getByRole("button", { name: "Expand to fullscreen" }));
    await user.click(screen.getByRole("button", { name: "Exit fullscreen" }));
    expect(screen.getByRole("button", { name: "Expand to fullscreen" })).toHaveFocus();
  });

  it("keeps focus inside the fullscreen dialog while tabbing", async () => {
    const user = userEvent.setup();
    render(<Harness initialMode="panel" />);
    await user.click(screen.getByRole("button", { name: "Expand to fullscreen" }));
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("Escape", () => {
  it("goes from fullscreen back to the panel", async () => {
    const user = userEvent.setup();
    render(<Harness initialMode="panel" />);
    await user.click(screen.getByRole("button", { name: "Expand to fullscreen" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: TITLE })).toBeInTheDocument();
  });

  it("closes the panel to the launcher", async () => {
    const user = userEvent.setup();
    render(<Harness initialMode="panel" />);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: `Open ${TITLE}` })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: TITLE })).toBeNull();
  });

  it("is ignored while an IME composition is in progress", () => {
    render(<Harness initialMode="panel" />);
    fireEvent.keyDown(document.body, { key: "Escape", isComposing: true });
    expect(screen.getByRole("region", { name: TITLE })).toBeInTheDocument();
  });
});

describe("Composer", () => {
  it("sends on Enter and clears the draft", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness initialMode="panel" onSend={onSend} />);
    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "  How do I roll back?{Enter}");
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("How do I roll back?");
    expect(textbox).toHaveValue("");
  });

  it("adds a newline on Shift+Enter without sending", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness initialMode="panel" onSend={onSend} />);
    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(textbox).toHaveValue("line one\nline two");
  });

  it("does not send on Enter during IME composition", () => {
    const onSend = vi.fn();
    render(<Harness initialMode="panel" onSend={onSend} />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "nihao" } });
    fireEvent.keyDown(textbox, { key: "Enter", keyCode: 229, isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables Send when the draft is empty or whitespace", async () => {
    const user = userEvent.setup();
    render(<Harness initialMode="panel" />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "   ");
    expect(send).toBeDisabled();
  });

  it("shows Stop while streaming and calls onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const streaming: UiMessage = { id: "a2", role: "assistant", content: "Partial", status: "streaming" };
    render(<Harness initialMode="panel" messages={[streaming]} isStreaming onCancel={onCancel} />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not send while streaming", () => {
    const onSend = vi.fn();
    render(<Harness initialMode="panel" isStreaming onSend={onSend} />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "follow up" } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows a counter near the 4000 character limit", () => {
    render(<Harness initialMode="panel" />);
    const textbox = screen.getByRole("textbox");
    expect(textbox).toHaveAttribute("maxlength", "4000");
    fireEvent.change(textbox, { target: { value: "x".repeat(3300) } });
    expect(screen.getByText("3300/4000")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("shows the welcome message and sends a suggestion when clicked", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness initialMode="panel" onSend={onSend} />);
    expect(screen.getByText("How can I help?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "How do I roll back?" }));
    expect(onSend).toHaveBeenCalledWith("How do I roll back?");
  });
});

describe("PageContextChip", () => {
  it("shows the asking-about context above the composer", () => {
    render(<Harness initialMode="panel" />);
    expect(screen.getByText("Asking about:")).toBeInTheDocument();
    expect(screen.getByText("Deployment › Rollback")).toBeInTheDocument();
  });
});
