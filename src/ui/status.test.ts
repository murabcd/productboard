import { describe, expect, test } from "bun:test";
import type { Category } from "../jira/types";
import { priorityMark, statusGlyph, statusLabel, statusStyle } from "./status";

const style = (status: string, category: Category) => statusStyle({ status, category });

describe("status colors", () => {
  test("each stage of the workflow has its own color", () => {
    expect(style("QA Blocked", "indeterminate")).toBe("error");
    expect(style("Release Blocked", "indeterminate")).toBe("error");
    expect(style("IN REVIEW", "indeterminate")).toBe("review");
    expect(style("Ready for QA", "indeterminate")).toBe("review");
    expect(style("IN QA", "indeterminate")).toBe("review");
    expect(style("Ready for release", "indeterminate")).toBe("ship");
    expect(style("In Progress", "indeterminate")).toBe("accent");
    expect(style("Product Research", "indeterminate")).toBe("accent");
    expect(style("Released", "done")).toBe("done");
    expect(style("Icebox", "done")).toBe("muted");
    expect(style("Ready for dev", "new")).toBe("muted");
  });
});

describe("row marks", () => {
  test("each stage has an icon", () => {
    expect(statusGlyph({ status: "QA Blocked", category: "indeterminate" })).toBe("⊘");
    expect(statusGlyph({ status: "In Progress", category: "indeterminate" })).toBe("◐");
    expect(statusGlyph({ status: "IN REVIEW", category: "indeterminate" })).toBe("◑");
    expect(statusGlyph({ status: "Ready for release", category: "indeterminate" })).toBe("◕");
    expect(statusGlyph({ status: "Released", category: "done" })).toBe("●");
    expect(statusGlyph({ status: "Ready for dev", category: "new" })).toBe("○");
    expect(statusGlyph({ status: "Backlog", category: "new" })).toBe("◌");
  });

  test("all-caps statuses read in sentence case, keeping acronyms", () => {
    expect(statusLabel("IN REVIEW")).toBe("In review");
    expect(statusLabel("IN QA")).toBe("In QA");
    expect(statusLabel("Ready for dev")).toBe("Ready for dev");
    expect(statusLabel("QA Blocked")).toBe("QA Blocked");
  });

  test("priority marks", () => {
    expect(priorityMark("Highest")[0]).toBe("!");
    expect(priorityMark("High")[0]).toBe("↑");
    expect(priorityMark("Medium")[0]).toBe(" ");
    expect(priorityMark("Lowest")[0]).toBe("↓");
    expect(priorityMark("")[0]).toBe(" ");
  });
});
