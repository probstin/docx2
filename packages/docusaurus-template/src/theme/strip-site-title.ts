/** `document.title` is "<page> | <site title>"; the site-title suffix is not part of the page title. */
export function stripSiteTitle(documentTitle: string, siteTitle: string): string {
  const suffix = ` | ${siteTitle}`;
  const stripped = documentTitle.endsWith(suffix) ? documentTitle.slice(0, -suffix.length) : documentTitle;
  return stripped.trim();
}
