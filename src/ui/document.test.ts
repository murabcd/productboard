import { describe, expect, test } from "bun:test";
import { toDoc } from "../jira/adf";
import { cells } from "../text";
import { type Line, layout, wrapSpans } from "./document";

const text = (value: string, marks: string[] = []) => ({
  type: "text",
  text: value,
  marks: marks.map((type) => ({ type })),
});
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const item = (...content: unknown[]) => ({ type: "listItem", content });
const cell = (type: string, value: string) => ({ type, content: [p(text(value))] });
const show = (lines: Line[]) => lines.map((line) => line.map((run) => run.text).join(""));

describe("rich text layout", () => {
  test("tables become bordered grids with a header row", () => {
    const table = {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", "Статус"), cell("tableHeader", "Кто")] },
        { type: "tableRow", content: [cell("tableCell", "Ready for QA"), cell("tableCell", "Cameron")] },
      ],
    };
    expect(show(layout(toDoc(doc(table)), 80))).toEqual([
      "┌──────────────┬─────────┐",
      "│ Статус       │ Кто     │",
      "├──────────────┼─────────┤",
      "│ Ready for QA │ Cameron │",
      "└──────────────┴─────────┘",
    ]);
  });

  test("a wide table fits the pane by wrapping its widest column", () => {
    const long = "очень длинное описание поведения, которое не помещается в одну строку";
    const table = {
      type: "table",
      content: [{ type: "tableRow", content: [cell("tableCell", "1"), cell("tableCell", long)] }],
    };
    const lines = show(layout(toDoc(doc(table)), 40));
    for (const line of lines) expect(cells(line)).toBeLessThanOrEqual(40);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines[1]).toStartWith("│ 1 │ очень");
    expect(lines[0]).toStartWith("┌───┬");
  });

  test("lists are numbered, nested and wrapped with a hanging indent", () => {
    const nested = { type: "bulletList", content: [item(p(text("вложенный пункт")))] };
    const list = {
      type: "orderedList",
      attrs: { order: 3 },
      content: [item(p(text("первый пункт с длинным текстом")), nested), item(p(text("второй")))],
    };
    expect(show(layout(toDoc(doc(list)), 20))).toEqual([
      "3. первый пункт с",
      "   длинным текстом",
      "   • вложенный пункт",
      "4. второй",
    ]);
  });

  test("tasks, code, panels, rules and headings keep their shape", () => {
    const content = toDoc(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("План")] },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { state: "DONE" }, content: [text("API")] },
            { type: "taskItem", attrs: { state: "TODO" }, content: [text("UI")] },
          ],
        },
        { type: "codeBlock", content: [text("const a = 1;\nconst b = 2;")] },
        { type: "panel", attrs: { panelType: "warning" }, content: [p(text("Осторожно"))] },
        { type: "rule" },
      ),
    );
    expect(show(layout(content, 30))).toEqual([
      "План",
      "",
      "☑ API",
      "☐ UI",
      "",
      "│ const a = 1;",
      "│ const b = 2;",
      "",
      "▌ Осторожно",
      "",
      "─".repeat(30),
    ]);
    const lines = layout(content, 30);
    expect(lines[0]?.[0]?.style).toBe("accentBold");
    expect(lines[5]?.[1]?.style).toBe("code");
    expect(lines[8]?.[0]?.style).toBe("warning");
  });

  test("inline marks, links, mentions and status labels are styled", () => {
    const content = toDoc(
      doc(
        p(
          text("bold", ["strong"]),
          text(" and "),
          { ...text("docs"), marks: [{ type: "link", attrs: { href: "https://x.io" } }] },
          text(" "),
          { type: "mention", attrs: { id: "1", text: "@Avery" } },
          text(" "),
          { type: "status", attrs: { text: "done" } },
        ),
      ),
    );
    const runs = layout(content, 80)[0] ?? [];
    expect(runs.map((r) => [r.text.trim(), r.style]).filter(([t]) => t)).toEqual([
      ["bold", "title"],
      ["and", "text"],
      ["docs", "link"],
      ["(https://x.io)", "muted"],
      ["@Avery", "mention"],
      ["DONE", "status"],
    ]);
  });

  test("long words split across lines and nothing exceeds the width", () => {
    const lines = show(
      wrapSpans([{ text: "https://example.com/a/very/long/path/that/never/breaks", style: "link" }], 16),
    );
    for (const line of lines) expect(cells(line)).toBeLessThanOrEqual(16);
    expect(lines.join("")).toBe("https://example.com/a/very/long/path/that/never/breaks");
  });
});
