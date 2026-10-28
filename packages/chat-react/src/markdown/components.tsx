import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { isSafeHref } from "../focus.js";
import { CodeBlock } from "./CodeBlock.js";

interface SafeLinkProps {
  href?: string;
  className?: string;
  title?: string;
  children?: ReactNode;
}

/**
 * Every link in a model answer goes through here. Unsafe targets (javascript:, data:, backslash
 * tricks, ...) render as their text only. Absolute http(s) links open in a new tab without opener access.
 */
function SafeLink({ href, className, title, children }: SafeLinkProps) {
  if (!href || !isSafeHref(href)) return <>{children}</>;
  if (/^https?:/i.test(href)) {
    return (
      <a href={href} className={className} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  );
}

/** Flattens react-markdown children to their text. Fenced code arrives as a single string. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

function languageOf(className: string | undefined): string | undefined {
  return /(?:^|\s)language-(\S+)/.exec(className ?? "")?.[1];
}

type CodeChildProps = { className?: string; children?: ReactNode };

/**
 * Images are never rendered as <img>, so the model cannot make the browser fetch arbitrary URLs.
 * They appear as a link labelled with the alt text.
 */
export const markdownComponents: Components = {
  a: (props) => (
    <SafeLink href={props.href} className={props.className} title={props.title}>
      {props.children}
    </SafeLink>
  ),
  img: (props) => (
    <SafeLink href={props.src} className="dp-chat-image-link">
      {props.alt?.trim() || "Image"}
    </SafeLink>
  ),
  pre: ({ children }) => {
    const child = Children.toArray(children).find(isValidElement) as ReactElement<CodeChildProps> | undefined;
    if (!child) return <pre>{children}</pre>;
    const code = textOf(child.props.children).replace(/\n$/, "");
    return <CodeBlock code={code} language={languageOf(child.props.className)} />;
  },
  code: ({ children }) => <code className="dp-chat-inline-code">{children}</code>,
  table: (props) => (
    <div className="dp-chat-table-scroll" role="region" aria-label="Table" tabIndex={0}>
      <table>{props.children}</table>
    </div>
  ),
};
