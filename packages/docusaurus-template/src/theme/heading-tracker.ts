/**
 * Finds which section heading of the current page the reader is at.
 *
 * Computed on demand (when the user sends a message) rather than observed: there are no
 * observers or scroll listeners, so nothing can go stale after a jump, a route change or a
 * layout shift. The current section is the last `h2`/`h3` (with an id, inside the article) whose
 * top edge is at or above the line just below the sticky navbar.
 */

export const HEADING_SELECTOR = "article h2[id], article h3[id]";
/** Roughly the height of the sticky navbar. */
export const TOP_OFFSET_PX = 80;

interface HeadingElement {
  textContent: string | null;
  getBoundingClientRect(): { top: number };
}

const ZWS_OR_SPACE = new RegExp(`[${String.fromCharCode(0x200b)}\\s]+`, "g");

export function headingText(el: Pick<HeadingElement, "textContent">): string {
  // Docusaurus appends a hash-link anchor with a zero-width space.
  return (el.textContent ?? "").replace(ZWS_OR_SPACE, " ").trim();
}

/** Text of the last heading scrolled past the top of the viewport, or undefined before the first one. */
export function currentHeading(root: {
  querySelectorAll(selector: string): ArrayLike<HeadingElement>;
}): string | undefined {
  const headings = Array.from(root.querySelectorAll(HEADING_SELECTOR));
  for (let i = headings.length - 1; i >= 0; i--) {
    const heading = headings[i] as HeadingElement;
    if (heading.getBoundingClientRect().top <= TOP_OFFSET_PX) return headingText(heading) || undefined;
  }
  return undefined;
}
