/** Base class so callers can distinguish "the repository content is wrong" from bugs. */
export class SourceError extends Error {
  override name = "SourceError";
}

export class DocsYamlError extends SourceError {
  override name = "DocsYamlError";
}

export class ContentPathError extends SourceError {
  override name = "ContentPathError";
}

export class GitError extends SourceError {
  override name = "GitError";
}

export interface SourceIssue {
  /** Repository-relative path the issue is about. */
  path: string;
  message: string;
}

/** The checkout contains content the platform refuses to build (MDX, escaping symlinks, ...). */
export class SourceValidationError extends SourceError {
  override name = "SourceValidationError";
  readonly issues: SourceIssue[];

  constructor(issues: SourceIssue[]) {
    super(
      `Source validation failed with ${issues.length} problem${issues.length === 1 ? "" : "s"}:\n` +
        issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n"),
    );
    this.issues = issues;
  }
}
