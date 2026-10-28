import type { SourceDocument } from "@docs-platform/contracts";
import { classifyLines, scanHeadings } from "@docs-platform/sources";
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

interface Section {
  depth: number;
  heading?: string;
  anchor?: string;
  lines: string[];
}

/**
 * Splits the body at the `##`-`######` headings the sources scanner found, by line index. Using
 * the scanner's own positions (rather than re-detecting headings) keeps anchors aligned with the
 * built HTML even when the scanner skips a heading (empty slug): that line simply stays in the
 * preceding section.
 */
function splitSections(doc: SourceDocument): Section[] {
  const lines = doc.content.split(/\r?\n/);
  const sections: Section[] = [{ depth: 0, lines: [] }];
  const headings = new Map(scanHeadings(doc.content).headings.map((h) => [h.line, h]));
  for (const [i, line] of lines.entries()) {
    const h = headings.get(i);
    if (h) sections.push({ depth: h.depth, heading: h.text, anchor: h.anchor, lines: [line] });
    else sections[sections.length - 1]!.lines.push(line);
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
  let fenced = false;
  const flush = (): void => {
    if (buf.length) out.push({ text: buf.join("\n"), fenced });
    buf = [];
  };
  const lines = text.split("\n");
  for (const [i, kind] of classifyLines(lines).entries()) {
    const inFence = kind === "fence" || kind === "fenceOpen";
    if (kind === "fenceOpen" || inFence !== fenced) flush();
    fenced = inFence;
    buf.push(lines[i]!);
  }
  flush();
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
