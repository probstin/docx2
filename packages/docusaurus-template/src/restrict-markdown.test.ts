import { describe, expect, it } from "vitest";
import { isOnlyComment } from "../plugins/restrict-markdown.js";

describe("restrict-markdown isOnlyComment", () => {
  it("accepts well-formed comments, including the heading-id anchor syntax", () => {
    for (const html of [
      "<!-- plain -->",
      "<!-- #custom-id -->",
      "  <!-- a -->\n<!-- b -->  ",
      "<!---->",
      "<!-- multi\nline -->",
      "<!-- a - b -->",
    ]) {
      expect(isOnlyComment(html), html).toBe(true);
    }
  });

  it("rejects comments browsers end early, nested payloads and non-comments", () => {
    for (const html of [
      "<!-- x --!><script>alert(1)</script> -->",
      "<!-- x --> <script>alert(1)</script>",
      "<!-- a -- b -->",
      "<!-- a --!> -->",
      "<!--> <script>alert(1)</script> -->",
      "<!---> <script>alert(1)</script> -->",
      "<!-- unterminated",
      "<script>alert(1)</script>",
      "<!-- a --> text",
      "",
    ]) {
      expect(isOnlyComment(html), html).toBe(false);
    }
  });
});
