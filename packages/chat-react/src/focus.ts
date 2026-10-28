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
  if (url.startsWith("//")) return false;
  if (url.startsWith("/") || url.startsWith("#")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
