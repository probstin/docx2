// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWidget } from "./ChatWidget.js";
import { okEvents, RELEASE, sseChunks, streamResponse } from "./test-helpers.js";

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

function renderWidget(fetchImpl: typeof fetch, pageContextEnabled = true) {
  return render(
    <ChatWidget
      endpoint="/api/v1/chat"
      releaseId={RELEASE}
      title="Ask AI"
      welcomeMessage="How can I help?"
      expandable
      pageContextEnabled={pageContextEnabled}
      getPageContext={() => ({ url: "http://x/docs/a", title: "Deploy", heading: "Rollback" })}
      storageKey="/docs:chat"
      fetchImpl={fetchImpl}
    />,
  );
}

describe("ChatWidget", () => {
  it("opens, streams an answer with citations, goes fullscreen and persists", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async () => streamResponse(sseChunks(okEvents, 9)));
    const view = renderWidget(fetchImpl as unknown as typeof fetch);

    await user.click(screen.getByRole("button", { name: "Open Ask AI" }));
    await user.type(screen.getByRole("textbox"), "how to roll back?");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByText(/Hello world/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("link", { name: /Deployment/ })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Expand to fullscreen" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();
    expect(screen.getByText("how to roll back?")).toBeInTheDocument();

    // Simulated navigation: remount keeps mode and conversation.
    view.unmount();
    renderWidget(fetchImpl as unknown as typeof fetch);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("omits title and heading from the request when page context is disabled", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return streamResponse(sseChunks(okEvents));
    }) as unknown as typeof fetch;
    renderWidget(fetchImpl, false);
    await user.click(screen.getByRole("button", { name: "Open Ask AI" }));
    expect(screen.queryByText("Rollback")).toBeNull();
    await user.type(screen.getByRole("textbox"), "hi{Enter}");
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0] as { context: object }).context).toEqual({
      releaseId: RELEASE,
      pageUrl: "http://x/docs/a",
    });
  });
});
