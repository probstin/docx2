import { DocsYamlSchema, SiteInfoSchema, type SiteInfo } from "@docs-platform/contracts";
import { getActiveRelease, toReleaseSummary, type Queryable } from "@docs-platform/storage";
import type { SiteService } from "../ports.js";

const DEFAULT_TITLE = "Documentation";
const defaultAssistant = () => SiteInfoSchema.shape.assistant.parse({});

/** `GET /api/v1/site` over storage: the active release and its stored `docs.yaml`. */
export function createSiteService(db: Queryable): SiteService {
  return {
    async getSiteInfo(): Promise<SiteInfo> {
      const release = await getActiveRelease(db);
      if (!release) {
        return { title: DEFAULT_TITLE, basePath: "/", assistant: defaultAssistant(), activeRelease: null };
      }
      const docs = DocsYamlSchema.safeParse(release.docsYaml);
      return {
        title: docs.success ? docs.data.site.title : DEFAULT_TITLE,
        basePath: docs.success ? docs.data.site.basePath : "/",
        assistant: docs.success ? docs.data.assistant : defaultAssistant(),
        activeRelease: toReleaseSummary(release),
      };
    },
  };
}
