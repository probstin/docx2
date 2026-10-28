/**
 * Remark plugin that makes repository Markdown strictly *content*.
 *
 * `markdown.format: "md"` already stops JSX, `import`, `export` and `{expressions}` from being
 * compiled (they render as literal text). It does not stop raw HTML: a `<script>` or
 * `<img onerror=...>` in a page would be copied verbatim into the generated HTML and run in
 * readers' browsers. This plugin fails the build instead of letting that happen.
 *
 * Runs before Docusaurus adds its own (MDX-typed) nodes, so it only ever sees author content.
 *
 * Allowed: Markdown syntax and HTML comments (`<!-- ... -->`, also used for `<!-- #heading-id -->`).
 * Rejected: any other raw HTML, any MDX node, and link/image URLs with a scheme other than
 * http, https, mailto or tel (`javascript:`, `data:`, ...).
 */

interface Position {
  start?: { line?: number; column?: number };
}

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  position?: Position;
}

interface MdFile {
  path?: string;
  cwd?: string;
}

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/**
 * True only for HTML made of one or more well-formed comments and whitespace. Strict on purpose:
 * browsers also end a comment at `--!>`, and treat `<!-->` / `<!--->` as empty comments, so bodies
 * may not contain `--` (which also rules out `--!>`) or start with `>` or `->`. Fails closed.
 */
const COMMENTS_ONLY = /^\s*(?:<!--(?!>|->)(?:(?!--)[\s\S])*-->\s*)+$/;

export function isOnlyComment(html: string): boolean {
  return COMMENTS_ONLY.test(html);
}

export default function restrictMarkdown() {
  return (tree: MdNode, file: MdFile) => {
    const where = (node: MdNode) => {
      const rel = file.path ? file.path.replace(`${file.cwd ?? ""}/`, "") : "(unknown file)";
      const line = node.position?.start?.line;
      return line ? `${rel}:${line}` : rel;
    };
    const fail = (node: MdNode, message: string): never => {
      throw new Error(`${where(node)}: ${message}`);
    };

    const stack: MdNode[] = [tree];
    while (stack.length > 0) {
      const node = stack.pop() as MdNode;
      if (node.type === "html" && !isOnlyComment(node.value ?? "")) {
        fail(
          node,
          `raw HTML is not allowed in documentation (found ${JSON.stringify((node.value ?? "").trim().slice(0, 60))}); use Markdown syntax`,
        );
      }
      if (node.type.startsWith("mdx")) {
        fail(node, "MDX/JSX is not allowed; documentation must be plain Markdown");
      }
      if (
        typeof node.url === "string" &&
        (node.type === "link" || node.type === "image" || node.type === "definition")
      ) {
        const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(node.url)?.[1]?.toLowerCase();
        if (scheme !== undefined && !SAFE_SCHEMES.has(scheme)) {
          fail(node, `links and images may not use the "${scheme}:" scheme`);
        }
      }
      if (node.children) stack.push(...[...node.children].reverse()); // visit in document order
    }
  };
}
