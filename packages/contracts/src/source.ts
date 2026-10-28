/** Where a snapshot comes from. Only `git` is implemented in the MVP. */
export interface GitSourceReference {
  type: "git";
  url: string;
  branch: string;
  /** Exact commit to check out. Builds always pin a SHA; never a moving branch. */
  revision: string;
}

export type SourceReference = GitSourceReference;

export interface SourceHeading {
  text: string;
  /** Docusaurus-compatible anchor id (without `#`). */
  anchor: string;
  /** 2–6 for `##`–`######`. */
  depth: number;
}

export interface SourceDocument {
  /** Stable within a source: the normalized repository-relative path. */
  id: string;
  /** Repository-relative path of the Markdown file. */
  path: string;
  /** Raw Markdown body with frontmatter removed. */
  content: string;
  /** sha256 hex of the raw file bytes. */
  checksum: string;
  metadata: {
    title: string;
    /** Site route relative to the site root, e.g. `/docs/guides/deployment`. Includes `basePath`. */
    url: string;
    headings: SourceHeading[];
    frontmatter: Record<string, unknown>;
  };
}

export interface SourceSnapshot {
  /** Git SHA for the MVP. */
  revision: string;
  documents: AsyncIterable<SourceDocument>;
}

export interface SourceAdapter {
  fetch(reference: SourceReference): Promise<SourceSnapshot>;
}
