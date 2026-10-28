import { createRequire } from "node:module";
import type { SourceHeading } from "@docs-platform/contracts";
import { parse, parseDocument, stringify } from "yaml";
import { SourceError } from "./errors.js";

// github-slugger 1.x (the version Docusaurus 3.10 uses) ships no type declarations; this keeps the
// exact algorithm without an ambient module declaration that every consumer would need to see.
const GithubSlugger = createRequire(import.meta.url)("github-slugger") as new () => {
  slug(value: string, maintainCase?: boolean): string;
};

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  /** Markdown after the frontmatter block. */
  body: string;
}

/** First line of a frontmatter block: `---` or `---<lang>` (a language starts with a letter). `-----` is not one. */
const FRONTMATTER_OPEN = /^---(?:[ \t]*|([A-Za-z][^\r\n]*))\r?\n/;

/**
 * Splits YAML frontmatter from the body. Frontmatter is parsed with `yaml` only: unlike
 * gray-matter, there is no `---js` engine, so repository content can never evaluate code.
 * Any non-YAML language marker (`---js`, `---coffee`, ...) is rejected.
 */
export function parseFrontmatter(raw: string, file = "(markdown)"): ParsedMarkdown {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const open = FRONTMATTER_OPEN.exec(text);
  if (!open) return { frontmatter: {}, body: text };

  const marker = (open[1] ?? "").trim();
  if (marker !== "" && marker !== "yaml") {
    throw new SourceError(`${file}: unsupported frontmatter language "${marker}" (only YAML is allowed)`);
  }
  const rest = text.slice(open[0].length);
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!close) return { frontmatter: {}, body: text };

  const yamlText = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length);
  let data: unknown;
  try {
    data = parse(yamlText, {
      maxAliasCount: 5,
      schema: "core",
      uniqueKeys: true,
      merge: false,
      logLevel: "error",
    });
  } catch (error) {
    throw new SourceError(
      `${file}: invalid frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (data === null || data === undefined) return { frontmatter: {}, body };
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new SourceError(`${file}: frontmatter must be a YAML mapping`);
  }
  return { frontmatter: data as Record<string, unknown>, body };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/**
 * Reduces the inline Markdown of a heading to the plain text that `mdast-util-to-string`
 * produces for it (which is what Docusaurus slugs): emphasis markers, link and image syntax and
 * code-span backticks disappear while their text stays, and raw inline HTML tags are dropped.
 */
export function inlineToText(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;

    if (ch === "\\" && i + 1 < src.length && ASCII_PUNCTUATION.test(src[i + 1] as string)) {
      out += src[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      let run = 1;
      while (src[i + run] === "`") run++;
      const fence = "`".repeat(run);
      let j = i + run;
      let end = -1;
      while (j < src.length) {
        const at = src.indexOf(fence, j);
        if (at === -1) break;
        let len = 0;
        while (src[at + len] === "`") len++;
        if (len === run) {
          end = at;
          break;
        }
        j = at + len;
      }
      if (end !== -1) {
        let code = src.slice(i + run, end).replace(/\r?\n/g, " ");
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") {
          code = code.slice(1, -1);
        }
        out += code;
        i = end + run;
        continue;
      }
      out += fence;
      i += run;
      continue;
    }

    if (ch === "[" || (ch === "!" && src[i + 1] === "[")) {
      const start = ch === "!" ? i + 1 : i;
      const close = findClosingBracket(src, start);
      if (close !== -1 && (src[close + 1] === "(" || src[close + 1] === "[")) {
        const closer = src[close + 1] === "(" ? ")" : "]";
        const tail = src.indexOf(closer, close + 2);
        if (tail !== -1) {
          out += inlineToText(src.slice(start + 1, close));
          i = tail + 1;
          continue;
        }
      }
    }

    if (ch === "<") {
      const autolink = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/.exec(src.slice(i));
      if (autolink) {
        out += autolink[1];
        i += autolink[0].length;
        continue;
      }
      const tag = /^<\/?[A-Za-z][^<>]*>|^<!--[\s\S]*?-->/.exec(src.slice(i));
      if (tag) {
        i += tag[0].length;
        continue;
      }
    }

    if (ch === "&") {
      const entity = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]+));/.exec(src.slice(i));
      if (entity) {
        let decoded: string | undefined;
        if (entity[1] !== undefined) decoded = safeCodePoint(Number.parseInt(entity[1], 10));
        else if (entity[2] !== undefined) decoded = safeCodePoint(Number.parseInt(entity[2], 16));
        else decoded = ENTITIES[entity[3] as string];
        if (decoded !== undefined) {
          out += decoded;
          i += entity[0].length;
          continue;
        }
      }
    }

    if (ch === "*") {
      i++;
      continue;
    }
    if (ch === "_") {
      // Intraword underscores (snake_case) are literal in CommonMark; others are emphasis.
      const prev = src[i - 1] ?? " ";
      const next = src[i + 1] ?? " ";
      if (/[\p{L}\p{N}]/u.test(prev) && /[\p{L}\p{N}]/u.test(next)) {
        out += ch;
      }
      i++;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

function safeCodePoint(n: number): string | undefined {
  if (n <= 0 || n > 0x10ffff) return undefined;
  try {
    return String.fromCodePoint(n);
  } catch {
    return undefined;
  }
}

function findClosingBracket(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Docusaurus `parseMarkdownHeadingId` (classic syntax): an id may contain anything except `{#` and `}`. */
const CLASSIC_ID = /\s*\{#(?<id>(?:.(?!\{#|\}))*.)\}$/;

function extractExplicitId(rawText: string): { text: string; id: string | undefined } {
  const classic = CLASSIC_ID.exec(rawText);
  if (classic?.groups?.id !== undefined) {
    return { text: rawText.replace(classic[0], ""), id: classic.groups.id.trim() };
  }
  // `## Heading <!-- #custom-id -->`: only the first word of the comment counts, and it needs a leading `#`.
  const comment = /^([\s\S]*?)\s*<!--([\s\S]*)-->$/.exec(rawText);
  if (comment) {
    const first = (comment[2] ?? "").trim().split(" ")[0] ?? "";
    if (first.startsWith("#") && first.length > 1) {
      return { text: comment[1] ?? "", id: first.slice(1) };
    }
  }
  return { text: rawText, id: undefined };
}

export interface ExtractedHeadings {
  /** `##`-`######` headings with their Docusaurus anchors. */
  headings: SourceHeading[];
  /** Text of the first `#` heading, if any. */
  h1: string | undefined;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/**
 * Line-based heading scanner. It understands fenced code blocks and HTML comments (headings
 * inside either are not headings), and reproduces the Docusaurus heading-id algorithm:
 *
 *  - ids come from `github-slugger` 1.x, one slugger per document, run over **every** heading
 *    including the `#` title, so a later `## Foo` after `# Foo` becomes `foo-1`;
 *  - an explicit `{#custom-id}` (or trailing `<!-- #custom-id -->`) is used verbatim, is stripped
 *    from the text and does not touch the slugger's duplicate counter.
 *
 * Only ATX headings (`## Title`) are recognized; setext underlines are not.
 */
export function extractHeadings(body: string): ExtractedHeadings {
  const slugger = new GithubSlugger();
  const headings: SourceHeading[] = [];
  let h1: string | undefined;

  let fence: { char: string; length: number } | undefined;
  let inComment = false;

  for (const line of body.split(/\r?\n/)) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && (close[1] as string)[0] === fence.char && (close[1] as string).length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open) {
      const marker = open[1] as string;
      // A backtick fence's info string may not contain backticks (else it is an inline code span).
      if (!(marker[0] === "`" && (open[2] ?? "").includes("`"))) {
        fence = { char: marker[0] as string, length: marker.length };
        continue;
      }
    }

    const trimmed = line.trimStart();
    if (trimmed.startsWith("<!--") && !trimmed.includes("-->")) {
      inComment = true;
      continue;
    }

    const match = ATX_HEADING.exec(line);
    if (!match) continue;
    const depth = (match[1] as string).length;
    const raw = (match[2] ?? "").trim();

    const { text: withoutId, id: explicitId } = extractExplicitId(raw);
    const text = inlineToText(withoutId).trim();
    const anchor = explicitId ?? slugger.slug(text);

    if (depth === 1) {
      h1 ??= text;
    } else if (anchor !== "") {
      headings.push({ text, anchor, depth });
    }
  }
  return { headings, h1 };
}

/**
 * Returns `raw` with the frontmatter key set to `value`, creating a frontmatter block when there
 * is none. The rest of the frontmatter and the body are preserved. Used by the site builder to
 * force the landing page's route; the original file in the checkout is never touched.
 */
export function setFrontmatterField(raw: string, key: string, value: unknown): string {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const open = FRONTMATTER_OPEN.exec(text);
  const rest = open ? text.slice(open[0].length) : "";
  const close = open ? /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest) : null;
  if (!open || !close) {
    return `---\n${stringify({ [key]: value }, { schema: "core" })}---\n${text}`;
  }
  const doc = parseDocument(rest.slice(0, close.index), { schema: "core", merge: false, logLevel: "error" });
  doc.set(key, value);
  return `---\n${doc.toString()}---\n${rest.slice(close.index + close[0].length)}`;
}
