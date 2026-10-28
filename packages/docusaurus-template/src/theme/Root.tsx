import type { ReactNode } from "react";

/**
 * Swizzled Root wrapper: renders on every page, outside the theme layout.
 */
export default function Root({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {/* TODO(wave-2): mount the React chat widget (@docs-platform/chat-react) into this element. */}
      <div id="docs-platform-chat-root" />
    </>
  );
}
