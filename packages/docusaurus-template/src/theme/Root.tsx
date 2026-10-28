import type { ReactNode } from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import "@docs-platform/chat-react/styles.css";
import { ChatWidget } from "@docs-platform/chat-react";
import { usePageContext } from "./usePageContext";

/** Used by `docusaurus start` when `platform.generated.json` has no release id. */
const DEV_RELEASE_ID = "dev-preview";

interface AssistantFields {
  enabled: boolean;
  title: string;
  welcomeMessage: string;
  pageContext: boolean;
  expandable: boolean;
}

/**
 * Swizzled Root wrapper: renders on every page, outside the theme layout.
 * Mounts the chat widget client-side only, so the static HTML stays free of widget state.
 */
export default function Root({ children }: { children: ReactNode }) {
  const { siteConfig } = useDocusaurusContext();
  const fields = siteConfig.customFields as {
    releaseId?: string;
    basePath?: string;
    apiBasePath?: string;
    assistant?: AssistantFields;
  };
  const getPageContext = usePageContext();
  const assistant = fields.assistant;

  return (
    <>
      {children}
      <div id="docs-platform-chat-root">
        {assistant?.enabled ? (
          <BrowserOnly>
            {() => (
              <ChatWidget
                endpoint={`${fields.apiBasePath ?? "/api/v1"}/chat`}
                // A missing release id only happens in a dev preview; the API rejects the fallback
                // with RELEASE_UNKNOWN, so chat answers need a real build.
                releaseId={fields.releaseId || DEV_RELEASE_ID}
                title={assistant.title}
                welcomeMessage={assistant.welcomeMessage}
                expandable={assistant.expandable}
                pageContextEnabled={assistant.pageContext}
                getPageContext={getPageContext}
                storageKey={`docs-platform:${fields.basePath ?? "/"}`}
              />
            )}
          </BrowserOnly>
        ) : null}
      </div>
    </>
  );
}
