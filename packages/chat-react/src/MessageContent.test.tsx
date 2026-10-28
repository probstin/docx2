// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Citation } from "@docs-platform/contracts";
import { MessageContent } from "./MessageContent.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const citations: Citation[] = [
  {
    index: 1,
    title: "Deployment",
    url: "/docs/guides/deployment#rollback",
    heading: "Rollback",
    anchor: "rollback",
    sourcePath: "docs/guides/deployment.md",
    releaseId: "20261027120000-abcdef1",
  },
];

describe("MessageContent safety", () => {
  it("renders a <script> tag in the text as escaped text, not an element", () => {
    const { container } = render(<MessageContent text={'Hello <script>alert("x")</script> world'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain('<script>alert("x")</script>');
  });

  it("renders an <img onerror> tag as escaped text, never as an element", () => {
    const { container } = render(<MessageContent text={"Look: <img src=x onerror=alert(1)>"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("does not render a javascript: link as an anchor", () => {
    render(<MessageContent text="[click me](javascript:alert(1))" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("click me")).toBeInTheDocument();
  });

  it("never produces a protocol-relative link from a backslash trick", () => {
    render(<MessageContent text={"[bad](/\\evil.example)"} />);
    // Backslashes are encoded, so the target stays a same-origin path rather than //host.
    const link = screen.queryByRole("link");
    if (link) expect(link.getAttribute("href")?.startsWith("//")).toBe(false);
  });

  it("renders images as links with the alt text, not as <img>", () => {
    const { container } = render(
      <MessageContent text="![architecture diagram](https://cdn.example.com/a.png)" />,
    );
    expect(container.querySelector("img")).toBeNull();
    const link = screen.getByRole("link", { name: "architecture diagram" });
    expect(link).toHaveAttribute("href", "https://cdn.example.com/a.png");
  });
});

describe("MessageContent links", () => {
  it("keeps site-relative links in the same tab", () => {
    render(<MessageContent text="See [the guide](/docs/guides/deployment)." />);
    const link = screen.getByRole("link", { name: "the guide" });
    expect(link).toHaveAttribute("href", "/docs/guides/deployment");
    expect(link).not.toHaveAttribute("target");
  });

  it("opens external links in a new tab with noopener noreferrer", () => {
    render(<MessageContent text="Read [the spec](https://example.com/spec)." />);
    const link = screen.getByRole("link", { name: "the spec" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("MessageContent citation markers", () => {
  it("turns [1] into a link to citation 1's url when that citation exists", () => {
    render(<MessageContent text="Roll back with the activate endpoint [1]." citations={citations} />);
    const marker = screen.getByRole("link", { name: "[1]" });
    expect(marker).toHaveAttribute("href", "/docs/guides/deployment#rollback");
    expect(marker).toHaveClass("dp-chat-cite");
  });

  it("links each number of grouped markers and leaves uncited numbers as text", () => {
    const two: Citation[] = [
      ...citations,
      { ...citations[0]!, index: 2, url: "/docs/other", anchor: undefined, heading: undefined },
    ];
    const { container } = render(
      <MessageContent text="A [1, 2] B [1,2] C [2][1] D [1, 3]." citations={two} />,
    );
    const links = screen.getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")]);
    const one = ["[1]", "/docs/guides/deployment#rollback"];
    const sec = ["[2]", "/docs/other"];
    expect(links).toEqual([one, sec, one, sec, sec, one, one]);
    expect(screen.queryByRole("link", { name: "[3]" })).toBeNull();
    expect(container.textContent).toBe("A [1][2] B [1][2] C [2][1] D [1][3].");
  });

  it("leaves [2] as plain text when no citation with that index exists", () => {
    render(<MessageContent text="Also see [2] for details." citations={citations} />);
    expect(screen.queryByRole("link", { name: "[2]" })).toBeNull();
    expect(screen.getByText(/Also see \[2\] for details\./)).toBeInTheDocument();
  });

  it("leaves [1] as plain text when the message has no citations", () => {
    render(<MessageContent text="Only [1] here." />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Only \[1\] here\./)).toBeInTheDocument();
  });

  it("does not turn [1] inside code into a citation", () => {
    const { container } = render(<MessageContent text="Use `arr[1]` in code." citations={citations} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("code")).toHaveTextContent("arr[1]");
  });
});

describe("MessageContent code blocks", () => {
  it("shows the language label and highlighted tokens", () => {
    const { container } = render(<MessageContent text={'```bash\necho "hi"\n```'} />);
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(container.querySelector("pre")).toHaveTextContent('echo "hi"');
    expect(container.querySelectorAll(".token").length).toBeGreaterThan(0);
  });

  it("falls back to a text label when the fence has no language", () => {
    render(<MessageContent text={"```\nplain\n```"} />);
    expect(screen.getByText("text")).toBeInTheDocument();
  });

  it("copies the exact code and shows Copied", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const code = "const a = 1;\n  return a;";
    render(<MessageContent text={"```ts\n" + code + "\n```"} />);

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith(code);
    expect(await screen.findByRole("button", { name: "Copied" })).toHaveTextContent("Copied");
  });

  it("reverts the copy label after 2 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<MessageContent text={"```bash\necho 1\n```"} />);

    await act(async () => {
      screen.getByRole("button", { name: "Copy code" }).click();
    });
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
  });
});

describe("MessageContent streaming and structure", () => {
  it("renders an unclosed code fence without throwing", () => {
    expect(() => render(<MessageContent text={"Here is code:\n\n```ts\nconst x = ["} />)).not.toThrow();
    expect(screen.getByText("ts")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "ts code" })).toHaveTextContent("const x =");
  });

  it("renders a GFM table inside a scrollable region", () => {
    render(<MessageContent text={["| Name | Value |", "| --- | --- |", "| retries | 3 |"].join("\n")} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "3" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Table" })).toBeInTheDocument();
  });

  it("renders headings, lists and inline code", () => {
    render(<MessageContent text={"## Steps\n\n- one\n- two\n\nRun `make`."} />);
    expect(screen.getByRole("heading", { name: "Steps" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("make").tagName).toBe("CODE");
  });

  it("shows user text verbatim when plain is set", () => {
    const { container } = render(<MessageContent text={"*not emphasis*"} plain />);
    expect(container.querySelector("em")).toBeNull();
    expect(container).toHaveTextContent("*not emphasis*");
  });
});
