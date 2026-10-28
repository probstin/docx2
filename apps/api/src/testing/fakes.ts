import type { SiteInfo } from "@docs-platform/contracts";
import type { ReadinessCheck, SiteService } from "../ports.js";

export const fakeSiteInfo: SiteInfo = {
  title: "Test Docs",
  basePath: "/",
  assistant: {
    enabled: true,
    title: "Docs assistant",
    welcomeMessage: "Hi",
    pageContext: true,
    citations: true,
    expandable: true,
  },
  activeRelease: null,
};

export class InMemorySiteService implements SiteService {
  constructor(private readonly info: SiteInfo = fakeSiteInfo) {}
  getSiteInfo() {
    return Promise.resolve(this.info);
  }
}

export const okCheck = (name: string): ReadinessCheck => ({ name, check: () => Promise.resolve() });
export const failingCheck = (name: string): ReadinessCheck => ({
  name,
  check: () => Promise.reject(new Error("db password=hunter2 unreachable")),
});
export const hangingCheck = (name: string): ReadinessCheck => ({
  name,
  check: () => new Promise<void>(() => undefined),
});
