/**
 * Tracks which section heading of the current page the reader has scrolled to.
 *
 * Observes the `h2`/`h3` elements that have ids inside the article with an IntersectionObserver
 * whose root margin collapses the viewport to a thin line just below the sticky navbar. A heading
 * counts as "passed" once its top edge is at or above that line; the current section is the last
 * passed heading in document order. The initial observer callback reports every element's state, so
 * a page opened mid-scroll (or at an anchor) starts correct.
 */

export const HEADING_SELECTOR = "article h2[id], article h3[id]";
/** Roughly the height of the sticky navbar. */
export const TOP_OFFSET_PX = 80;

export interface HeadingTracker {
  /** Text of the last heading scrolled past the top, or undefined before the first one. */
  current(): string | undefined;
  dispose(): void;
}

interface HeadingElement {
  textContent: string | null;
}

interface ObserverEntry {
  target: unknown;
  boundingClientRect: { top: number };
}

type ObserverCtor = new (
  callback: (entries: ObserverEntry[]) => void,
  options: { rootMargin: string },
) => { observe(target: never): void; disconnect(): void };

const ZWS_OR_SPACE = new RegExp(`[${String.fromCharCode(0x200b)}\\s]+`, "g");

export function headingText(el: HeadingElement): string {
  // Docusaurus appends a hash-link anchor with a zero-width space.
  return (el.textContent ?? "").replace(ZWS_OR_SPACE, " ").trim();
}

export function trackHeadings(
  root: { querySelectorAll(selector: string): ArrayLike<HeadingElement> },
  Observer: ObserverCtor | undefined = (globalThis as { IntersectionObserver?: unknown })
    .IntersectionObserver as ObserverCtor | undefined,
): HeadingTracker {
  const headings = Array.from(root.querySelectorAll(HEADING_SELECTOR));
  if (!Observer || headings.length === 0) return { current: () => undefined, dispose() {} };

  const passed = new Map<unknown, boolean>();
  const observer = new Observer(
    (entries) => {
      for (const entry of entries) passed.set(entry.target, entry.boundingClientRect.top <= TOP_OFFSET_PX);
    },
    // A zero-height band TOP_OFFSET_PX below the top of the viewport.
    { rootMargin: `-${TOP_OFFSET_PX}px 0px -100% 0px` },
  );
  for (const heading of headings) observer.observe(heading as never);

  return {
    current() {
      for (let i = headings.length - 1; i >= 0; i--) {
        if (passed.get(headings[i])) return headingText(headings[i] as HeadingElement) || undefined;
      }
      return undefined;
    },
    dispose() {
      observer.disconnect();
      passed.clear();
    },
  };
}
