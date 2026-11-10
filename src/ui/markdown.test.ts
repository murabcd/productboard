import { describe, expect, test } from "bun:test";
import { layout } from "./document";
import { markdownBlocks } from "./markdown";

const render = (markdown: string) =>
  layout(markdownBlocks(markdown), 60).map((line) => line.map((run) => run.text).join(""));

describe("Agent Markdown", () => {
  test("headings, lists and inline styles lay out like Jira text", () => {
    expect(render("## Summary\n- Total: **14**\n- Code: `a<b`\n  - nested\n\n1. first\n2. second")).toEqual([
      "Summary",
      "",
      "• Total: 14",
      "• Code: a<b",
      "   • nested",
      "1. first",
      "2. second",
    ]);
  });

  test("bold and code keep their styles; plain text stays plain for issue links", () => {
    const [line] = layout(markdownBlocks("See **FL-1** and `x` in FL-2"), 60);
    expect(line?.map((run) => [run.text, run.style])).toEqual([
      ["See ", "text"],
      ["FL-1", "title"],
      [" and ", "text"],
      ["x", "code"],
      [" in FL-2", "text"],
    ]);
  });
});
