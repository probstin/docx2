const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Keeps Tab / Shift+Tab cycling inside `container` (used by the fullscreen dialog).
 */
export function trapTabKey(
  event: { key: string; shiftKey: boolean; preventDefault(): void },
  container: HTMLElement,
) {
  if (event.key !== "Tab") return;
  const focusable = getFocusable(container);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const outside = !(active instanceof Node) || !container.contains(active);
  if (event.shiftKey) {
    if (outside || active === first) {
      event.preventDefault();
      last.focus();
    }
  } else if (outside || active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Allows site-relative paths, fragments, and absolute http(s) URLs only. */
export function isSafeHref(url: string): boolean {
  // Backslashes and control characters are normalised or stripped by browsers (`/\evil.example`
  // becomes `//evil.example`), so none are allowed anywhere.
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  if (/[\\\u0000-\u001f\u007f]/.test(url)) return false;
  if (url === "/" || url.startsWith("#")) return true;
  if (url.startsWith("/")) return url[1] !== "/";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
