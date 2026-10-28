import { useCallback, useRef } from "react";
import { useLocation } from "@docusaurus/router";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import { currentHeading } from "./heading-tracker";
import { stripSiteTitle } from "./strip-site-title";

export interface PageContext {
  url: string;
  title?: string;
  heading?: string;
}

/**
 * Returns a stable `getPageContext` for the chat widget. It reads from refs and the DOM at call
 * time, so scrolling never re-renders anything and nothing can go stale. The URL includes the
 * hash so the server can boost the section the reader is on.
 */
export function usePageContext(): () => PageContext {
  const { pathname, hash } = useLocation();
  const { siteConfig } = useDocusaurusContext();
  const urlRef = useRef(pathname + hash);
  const siteTitleRef = useRef(siteConfig.title);
  urlRef.current = pathname + hash;
  siteTitleRef.current = siteConfig.title;

  return useCallback((): PageContext => {
    const title = stripSiteTitle(document.title, siteTitleRef.current);
    const heading = currentHeading(document);
    return {
      url: urlRef.current,
      ...(title ? { title } : {}),
      ...(heading ? { heading } : {}),
    };
  }, []);
}
