import type { Citation } from "@docs-platform/contracts";

/** The mdast fields this plugin touches. Declared locally to avoid a direct dependency on @types/mdast. */
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, string>; [key: string]: unknown };
}

const CITATION_PATTERN = /\[(\d+)\]/g;

/** Node types whose text must be left alone: a `[1]` inside a link or code is not a citation marker. */
const OPAQUE_TYPES = new Set(["link", "linkReference", "inlineCode", "code", "definition"]);

/**
 * Remark plugin: turns `[n]` text into a link to citation `n`'s url, but only when a citation
 * with that index exists. Other bracketed numbers stay as plain text.
 */
export function remarkCitationLinks(citations: readonly Citation[] | undefined) {
  const urlByIndex = new Map<number, string>(
    (citations ?? []).map((citation) => [citation.index, citation.url]),
  );

  return () => (tree: MdNode) => {
    if (urlByIndex.size > 0) linkifyChildren(tree, urlByIndex);
  };
}

function linkifyChildren(node: MdNode, urlByIndex: Map<number, string>) {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      next.push(...splitText(child.value, urlByIndex));
    } else {
      if (!OPAQUE_TYPES.has(child.type)) linkifyChildren(child, urlByIndex);
      next.push(child);
    }
  }
  node.children = next;
}

function splitText(value: string, urlByIndex: Map<number, string>): MdNode[] {
  const parts: MdNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(CITATION_PATTERN)) {
    const index = Number(match[1]);
    const url = urlByIndex.get(index);
    const start = match.index ?? 0;
    if (url === undefined) continue;
    if (start > cursor) parts.push({ type: "text", value: value.slice(cursor, start) });
    parts.push({
      type: "link",
      url,
      children: [{ type: "text", value: match[0] }],
      data: { hProperties: { className: "dp-chat-cite", title: `Source ${index}` } },
    });
    cursor = start + match[0].length;
  }
  if (parts.length === 0) return [{ type: "text", value }];
  if (cursor < value.length) parts.push({ type: "text", value: value.slice(cursor) });
  return parts;
}
