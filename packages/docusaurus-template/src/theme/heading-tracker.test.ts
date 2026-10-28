import { describe, expect, it } from "vitest";
import { HEADING_SELECTOR, TOP_OFFSET_PX, currentHeading, headingText } from "./heading-tracker";
import { stripSiteTitle } from "./strip-site-title";

const h = (text: string, top: number) => ({ textContent: text, getBoundingClientRect: () => ({ top }) });

describe("currentHeading", () => {
  it("returns the last heading at or above the navbar line, and nothing before the first", () => {
    const root = (...els: ReturnType<typeof h>[]) => ({ querySelectorAll: () => els });
    expect(currentHeading(root(h("Intro", 500), h("Setup", 900)))).toBeUndefined();
    expect(currentHeading(root(h("Intro\u200b", -20), h("Setup", 500)))).toBe("Intro");
    expect(currentHeading(root(h("Intro", -300), h("Setup", TOP_OFFSET_PX), h("Deploy", 300)))).toBe("Setup");
  });

  it("reflects a jump immediately because it reads the layout at call time", () => {
    const tops = { a: 10, b: 600, c: 1200 };
    const els = [
      { textContent: "A", getBoundingClientRect: () => ({ top: tops.a }) },
      { textContent: "B", getBoundingClientRect: () => ({ top: tops.b }) },
      { textContent: "C", getBoundingClientRect: () => ({ top: tops.c }) },
    ];
    const root = { querySelectorAll: () => els };
    expect(currentHeading(root)).toBe("A");
    // Jump to C (e.g. an anchor link or End key): no scroll events needed.
    Object.assign(tops, { a: -2000, b: -1400, c: 20 });
    expect(currentHeading(root)).toBe("C");
    // Jump back to the top.
    Object.assign(tops, { a: 300, b: 900, c: 1500 });
    expect(currentHeading(root)).toBeUndefined();
  });

  it("queries only article h2/h3 headings with ids", () => {
    const selectors: string[] = [];
    currentHeading({
      querySelectorAll: (s) => {
        selectors.push(s);
        return [];
      },
    });
    expect(selectors).toEqual([HEADING_SELECTOR]);
    expect(HEADING_SELECTOR).toBe("article h2[id], article h3[id]");
  });

  it("normalizes heading text", () => {
    expect(headingText({ textContent: "  Set\u200b up \n now " })).toBe("Set up now");
  });
});

describe("stripSiteTitle", () => {
  it("removes only the site-title suffix", () => {
    expect(stripSiteTitle("Deployment | Atlas Docs", "Atlas Docs")).toBe("Deployment");
    expect(stripSiteTitle("Atlas Docs", "Atlas Docs")).toBe("Atlas Docs");
    expect(stripSiteTitle("A | B | Atlas Docs", "Atlas Docs")).toBe("A | B");
  });
});
