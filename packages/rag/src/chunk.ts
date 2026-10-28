import type { SourceDocument } from "@docs-platform/contracts";
import { inlineToText } from "@docs-platform/sources";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Chunk } from "./types.js";

export interface ChunkOptions {
  /** Target maximum characters per chunk (default 1500). */
  chunkSize?: number;
  /** Overlap when an oversized text run must be split (default 200). */
  chunkOverlap?: number;
}

export const DEFAULT_CHUNK_SIZE = 1500;
export const DEFAULT_CHUNK_OVERLAP = 200;
/** A lone code fence up to this multiple of chunkSize is kept whole rather than split mid-block. */
const FENCE_KEEP_FACTOR = 3;
const HEADING_SEPARATOR = " › ";

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

interface Section {
  depth: number;
  heading?: string;
  anchor?: string;
  lines: string[];
}

/**
 * Splits the body at `##`-`######` headings. The line-level fence/comment tracking mirrors the
 * sources package's heading scanner; anchors are not recomputed here but taken, in order, from
 * `doc.metadata.headings` (which that scanner produced), so they match the built HTML exactly.
 */
function splitSections(doc: SourceDocument): Section[] {
  const known = doc.metadata.headings;
  let next = 0;
  const sections: Section[] = [{ depth: 0, lines: [] }];
  let fence: { char: string; length: number } | undefined;
  let inComment = false;

  for (const line of doc.content.split(/\r?\n/)) {
    const cur = sections[sections.length - 1]!;
    if (fence) {
      cur.lines.push(line);
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = undefined;
      continue;
    }
    if (inComment) {
      cur.lines.push(line);
      if (line.includes("-->")) inComment = false;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const marker = open[1]!;
      if (!(marker[0] === "`" && (open[2] ?? "").includes("`"))) {
        fence = { char: marker[0]!, length: marker.length };
        cur.lines.push(line);
        continue;
      }
    }
    const trimmed = line.trimStart();
    if (trimmed.startsWith("<!--") && !trimmed.includes("-->")) {
      inComment = true;
      cur.lines.push(line);
      continue;
    }
    const m = ATX_HEADING.exec(line);
    if (!m || m[1]!.length === 1) {
      cur.lines.push(line);
      continue;
    }
    const depth = m[1]!.length;
    const known_ = known[next];
    let heading: string;
    let anchor: string | undefined;
    if (known_ && known_.depth === depth) {
      heading = known_.text;
      anchor = known_.anchor;
      next++;
    } else {
      // Heading without an anchor (the scanner skips empty slugs): keep the text, no anchor.
      heading = inlineToText(m[2] ?? "").trim();
    }
    sections.push({ depth, heading, anchor, lines: [line] });
  }
  return sections;
}

interface Segment {
  text: string;
  fenced: boolean;
}

/** Splits a section into alternating prose and fenced-code segments. */
function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let buf: string[] = [];
  let fence: { char: string; length: number } | undefined;
  const flush = (fenced: boolean): void => {
    if (buf.length) out.push({ text: buf.join("\n"), fenced });
    buf = [];
  };
  for (const line of text.split("\n")) {
    if (fence) {
      buf.push(line);
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) {
        fence = undefined;
        flush(true);
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1]![0] === "`" && (open[2] ?? "").includes("`"))) {
      flush(false);
      fence = { char: open[1]![0]!, length: open[1]!.length };
      buf.push(line);
      continue;
    }
    buf.push(line);
  }
  flush(fence !== undefined);
  return out;
}

async function splitOversized(
  text: string,
  size: number,
  splitter: RecursiveCharacterTextSplitter,
): Promise<string[]> {
  if (text.length <= size) return [text];
  return (await splitter.splitText(text)).map((s) => s.trim()).filter(Boolean);
}

async function splitSectionText(text: string, size: number, splitter: RecursiveCharacterTextSplitter) {
  if (text.length <= size) return [text];
  const buffers: Segment[] = [];
  for (const seg of segments(text)) {
    const last = buffers[buffers.length - 1];
    if (last && last.text.length + 1 + seg.text.length <= size) {
      last.text += `\n${seg.text}`;
      last.fenced = last.fenced && seg.fenced;
    } else {
      buffers.push({ ...seg });
    }
  }
  const out: string[] = [];
  for (const b of buffers) {
    if (b.text.length <= size || (b.fenced && b.text.length <= size * FENCE_KEEP_FACTOR)) out.push(b.text);
    else out.push(...(await splitOversized(b.text, size, splitter)));
  }
  return out;
}

/** Chunks a document by heading sections; oversized sections are split further. */
export async function chunkDocument(doc: SourceDocument, options: ChunkOptions = {}): Promise<Chunk[]> {
  const size = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = Math.min(options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP, Math.floor(size / 2));
  const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
    chunkSize: size,
    chunkOverlap: overlap,
  });
  const title = doc.metadata.title;
  const chunks: Chunk[] = [];
  const stack: { depth: number; text: string }[] = [];

  for (const section of splitSections(doc)) {
    if (section.heading !== undefined) {
      while (stack.length && stack[stack.length - 1]!.depth >= section.depth) stack.pop();
      stack.push({ depth: section.depth, text: section.heading });
    }
    const text = section.lines.join("\n").trim();
    // Skip sections with no body (e.g. a heading directly followed by a subheading).
    // Skip sections with no body: heading-only sections and an intro holding nothing but the `#` title.
    const body = (section.heading !== undefined ? section.lines.slice(1) : section.lines)
      .filter((l) => !/^ {0,3}#[ \t]/.test(l))
      .join("\n")
      .trim();
    if (!body) continue;

    const path = [title, ...stack.map((s) => s.text)]
      .filter((p, i, a) => i === 0 || p !== a[i - 1])
      .join(HEADING_SEPARATOR);
    for (const piece of await splitSectionText(text, size, splitter)) {
      chunks.push({
        ordinal: chunks.length,
        heading: section.heading,
        anchor: section.anchor,
        headingPath: path,
        content: piece,
        embedText: `${path}\n\n${piece}`,
      });
    }
  }
  return chunks;
}
