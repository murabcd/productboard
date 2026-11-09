import { describe, expect, test } from "bun:test";
import type { Category } from "../jira/types";
import { statusStyle } from "./status";

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
