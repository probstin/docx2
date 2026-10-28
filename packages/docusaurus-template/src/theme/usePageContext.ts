import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "@docusaurus/router";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import { trackHeadings, type HeadingTracker } from "./heading-tracker";
import { stripSiteTitle } from "./strip-site-title";

export interface PageContext {
  url: string;
  title?: string;
  heading?: string;
}

/**
 * Returns a stable `getPageContext` for the chat widget. It reads from refs and the DOM at call
 * time, so scrolling never re-renders anything. The heading tracker restarts on every route change.
 */
export function usePageContext(): () => PageContext {
  const { pathname } = useLocation();
  const { siteConfig } = useDocusaurusContext();
  const pathnameRef = useRef(pathname);
  const siteTitleRef = useRef(siteConfig.title);
  const trackerRef = useRef<HeadingTracker | undefined>(undefined);
  pathnameRef.current = pathname;
  siteTitleRef.current = siteConfig.title;

  useEffect(() => {
    trackerRef.current = trackHeadings(document);
    return () => {
      trackerRef.current?.dispose();
      trackerRef.current = undefined;
    };
  }, [pathname]);

  return useCallback((): PageContext => {
    const title = stripSiteTitle(document.title, siteTitleRef.current);
    const heading = trackerRef.current?.current();
    return {
      url: pathnameRef.current,
      ...(title ? { title } : {}),
      ...(heading ? { heading } : {}),
    };
  }, []);
}
