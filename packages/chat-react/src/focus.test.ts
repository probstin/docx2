import { describe, expect, it } from "vitest";
import { isSafeHref } from "./focus.js";

describe("isSafeHref", () => {
  it("allows site-relative paths, fragments and http(s) URLs", () => {
    for (const url of [
      "/",
      "/docs/intro",
      "/docs/a?b=1#c",
      "#section",
      "http://a.example/x",
      "https://a.example",
    ]) {
      expect(isSafeHref(url), url).toBe(true);
    }
  });

  it("rejects protocol-relative and backslash variants", () => {
    for (const url of [
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/a\\b",
      "https://a.example\\@b",
    ]) {
      expect(isSafeHref(url), url).toBe(false);
    }
  });

  it("rejects control characters and other schemes", () => {
    for (const url of [
      "/\t/evil.example",
      "/\n/evil.example",
      "/a\u0000b",
      "javascript:alert(1)",
      "data:text/html,x",
      "",
      "docs/x",
    ]) {
      expect(isSafeHref(url), url).toBe(false);
    }
  });
});
