import { describe, expect, it } from "vitest";
import { TOP_OFFSET_PX, headingText, trackHeadings } from "./heading-tracker";
import { stripSiteTitle } from "./strip-site-title";

type Callback = (entries: { target: unknown; boundingClientRect: { top: number } }[]) => void;

class FakeObserver {
  static last: FakeObserver;
  observed: unknown[] = [];
  disconnected = false;
  constructor(
    readonly callback: Callback,
    readonly options: { rootMargin: string },
  ) {
    FakeObserver.last = this;
  }
  observe(target: unknown) {
    this.observed.push(target);
  }
  disconnect() {
    this.disconnected = true;
  }
}

const h = (text: string) => ({ textContent: text });

describe("trackHeadings", () => {
  it("returns the last heading scrolled past the top, and nothing before the first", () => {
    const [a, b, c] = [h("Intro​"), h("Setup"), h("Deploy")];
    const tracker = trackHeadings({ querySelectorAll: () => [a, b, c] }, FakeObserver);
    const io = FakeObserver.last;
    expect(io.observed).toEqual([a, b, c]);
    expect(io.options.rootMargin).toBe(`-${TOP_OFFSET_PX}px 0px -100% 0px`);

    // Initial report: everything is below the line.
    io.callback([a, b, c].map((target) => ({ target, boundingClientRect: { top: 500 } })));
    expect(tracker.current()).toBeUndefined();

    io.callback([{ target: a, boundingClientRect: { top: -20 } }]);
    expect(tracker.current()).toBe("Intro");
    io.callback([
      { target: b, boundingClientRect: { top: 10 } },
      { target: c, boundingClientRect: { top: 300 } },
    ]);
    expect(tracker.current()).toBe("Setup");

    // Scrolling back up: b is below the line again.
    io.callback([{ target: b, boundingClientRect: { top: 200 } }]);
    expect(tracker.current()).toBe("Intro");

    tracker.dispose();
    expect(io.disconnected).toBe(true);
    expect(tracker.current()).toBeUndefined();
  });

  it("is inert without headings or IntersectionObserver", () => {
    expect(trackHeadings({ querySelectorAll: () => [] }, FakeObserver).current()).toBeUndefined();
    expect(trackHeadings({ querySelectorAll: () => [h("x")] }, undefined).current()).toBeUndefined();
  });

  it("normalizes heading text", () => {
    expect(headingText(h("  Set​ up \n now "))).toBe("Set up now");
  });
});

describe("stripSiteTitle", () => {
  it("removes only the site-title suffix", () => {
    expect(stripSiteTitle("Deployment | Atlas Docs", "Atlas Docs")).toBe("Deployment");
    expect(stripSiteTitle("Atlas Docs", "Atlas Docs")).toBe("Atlas Docs");
    expect(stripSiteTitle("A | B | Atlas Docs", "Atlas Docs")).toBe("A | B");
  });
});
