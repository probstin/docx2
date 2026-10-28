import { readFile, stat } from "node:fs/promises";
import { DOCS_YAML_FILENAME, DocsYamlSchema, type DocsYaml } from "@docs-platform/contracts";
import { parse } from "yaml";
import { ContentPathError, DocsYamlError } from "./errors.js";
import { resolveContentPath } from "./paths.js";

const MAX_DOCS_YAML_BYTES = 256 * 1024;

/**
 * Reads and validates `docs.yaml` from the checkout root.
 *
 * Parsing uses the `yaml` package's core schema (no custom tags, no code), with a very low alias
 * limit so alias expansion cannot be used to blow up memory. All errors are `DocsYamlError`s
 * whose messages name the file.
 */
export async function loadDocsYaml(checkoutDir: string): Promise<DocsYaml> {
  let file: string;
  try {
    file = await resolveContentPath(checkoutDir, DOCS_YAML_FILENAME);
  } catch (error) {
    if (error instanceof ContentPathError) {
      throw new DocsYamlError(`${DOCS_YAML_FILENAME}: ${error.message}`);
    }
    throw error;
  }
  const info = await stat(file);
  if (!info.isFile()) throw new DocsYamlError(`${DOCS_YAML_FILENAME}: not a regular file`);
  if (info.size > MAX_DOCS_YAML_BYTES) {
    throw new DocsYamlError(`${DOCS_YAML_FILENAME}: file is larger than ${MAX_DOCS_YAML_BYTES} bytes`);
  }
  return parseDocsYaml(await readFile(file, "utf8"));
}

/** Validates the text of a `docs.yaml`. Exported for tests and for callers that already hold the text. */
export function parseDocsYaml(text: string): DocsYaml {
  let data: unknown;
  try {
    data = parse(text, {
      maxAliasCount: 5,
      schema: "core",
      uniqueKeys: true,
      merge: false,
      logLevel: "error",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DocsYamlError(`${DOCS_YAML_FILENAME}: invalid YAML: ${message}`);
  }
  if (data === null || data === undefined) {
    throw new DocsYamlError(`${DOCS_YAML_FILENAME}: file is empty`);
  }
  const result = DocsYamlSchema.safeParse(data);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${where}: ${issue.message}`;
    });
    throw new DocsYamlError(`${DOCS_YAML_FILENAME} is invalid:\n${lines.join("\n")}`);
  }
  return result.data;
}
