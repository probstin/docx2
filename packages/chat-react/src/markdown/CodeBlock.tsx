import { Highlight } from "prism-react-renderer";
import { CopyButton } from "./CopyButton.js";

export interface CodeBlockProps {
  code: string;
  /** Language from the fence info string, if any. */
  language?: string;
}

/** Fence names people commonly write that Prism registers under a different id. */
const LANGUAGE_ALIASES: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  js: "javascript",
  ts: "typescript",
  yml: "yaml",
  md: "markdown",
  plaintext: "text",
};

/** No inline colours: token classes are styled from CSS variables so light and dark themes both work. */
const CSS_THEME = { plain: {}, styles: [] };

export function CodeBlock({ code, language }: CodeBlockProps) {
  const label = language?.trim() || "text";
  const key = label.toLowerCase();
  const prismLanguage = LANGUAGE_ALIASES[key] ?? key;

  return (
    <div className="dp-chat-codeblock">
      <div className="dp-chat-codeblock-header">
        <span className="dp-chat-codeblock-language">{label}</span>
        <CopyButton
          text={code}
          label="Copy code"
          copiedLabel="Copied"
          className="dp-chat-codeblock-copy"
          showText
        />
      </div>
      <Highlight code={code} language={prismLanguage} theme={CSS_THEME}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre className="dp-chat-codeblock-pre" role="region" aria-label={`${label} code`} tabIndex={0}>
            <code className="dp-chat-codeblock-code">
              {tokens.map((line, lineIndex) => (
                <div key={lineIndex} {...getLineProps({ line })} className="dp-chat-codeblock-line">
                  {line.map((token, tokenIndex) => (
                    <span key={tokenIndex} {...getTokenProps({ token })} />
                  ))}
                </div>
              ))}
            </code>
          </pre>
        )}
      </Highlight>
    </div>
  );
}
