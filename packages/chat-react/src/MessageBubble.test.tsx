// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageBubble } from "./MessageBubble.js";
import type { UiMessage } from "./types.js";

afterEach(cleanup);

const citations = [
  {
    index: 1,
    title: "Deployment",
    url: "/docs/guides/deployment#rollback",
    heading: "Rollback",
    anchor: "rollback",
    sourcePath: "docs/guides/deployment.md",
    releaseId: "20261027120000-abcdef1",
  },
  {
    index: 2,
    title: "Architecture",
    url: "/docs/architecture/overview",
    sourcePath: "docs/architecture/overview.md",
    releaseId: "20261027120000-abcdef1",
  },
];

function assistant(overrides: Partial<UiMessage> = {}): UiMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "Roll back with the activate endpoint.",
    status: "complete",
    ...overrides,
  };
}

describe("MessageBubble", () => {
  it("renders citations as links with the right hrefs", () => {
    render(<MessageBubble message={assistant({ citations })} />);
    const rollback = screen.getByRole("link", { name: /Deployment › Rollback/ });
    expect(rollback).toHaveAttribute("href", "/docs/guides/deployment#rollback");
    const overview = screen.getByRole("link", { name: /^Architecture/ });
    expect(overview).toHaveAttribute("href", "/docs/architecture/overview");
    expect(rollback).not.toHaveAttribute("target");
    expect(screen.getByRole("navigation", { name: "Sources" })).toBeInTheDocument();
  });

  it("does not render a link for unsafe citation URLs", () => {
    render(
      <MessageBubble
        message={assistant({ citations: [{ ...citations[0]!, url: "javascript:alert(1)" }] })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Deployment › Rollback")).toBeInTheDocument();
  });

  it("shows the insufficient-context notice", () => {
    render(<MessageBubble message={assistant({ answerStatus: "insufficient_context" })} />);
    expect(screen.getByText("Not found in the documentation")).toBeInTheDocument();
  });

  it("does not show the notice for grounded answers", () => {
    render(<MessageBubble message={assistant({ answerStatus: "grounded" })} />);
    expect(screen.queryByText("Not found in the documentation")).toBeNull();
  });

  it("shows the error message and a Retry button that reports the message id", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <MessageBubble
        message={assistant({ status: "error", content: "", errorMessage: "The model is unavailable." })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The model is unavailable.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith("m1");
  });

  it("hides Retry when no handler is provided", () => {
    render(<MessageBubble message={assistant({ status: "error", content: "", errorMessage: "Boom" })} />);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows a typing indicator while streaming with no text yet", () => {
    render(<MessageBubble message={assistant({ status: "streaming", content: "" })} />);
    expect(screen.getByText("Generating answer")).toBeInTheDocument();
  });

  it("shows a Stopped note when cancelled", () => {
    render(<MessageBubble message={assistant({ status: "cancelled", content: "Partial answer" })} />);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText("Partial answer")).toBeInTheDocument();
  });

  it("labels the author", () => {
    render(<MessageBubble message={{ id: "u1", role: "user", content: "Hi", status: "complete" }} />);
    expect(screen.getByRole("article", { name: "You" })).toBeInTheDocument();
  });
});
