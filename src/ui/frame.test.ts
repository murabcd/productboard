import { describe, expect, test } from "bun:test";
import { initialQuery, View } from "../jira/query";
import { Workspace } from "../state/workspace";
import { deferred, snapshot } from "../testing";
import { Dashboard } from "./dashboard";
import { frame } from "./frame";

function teamFocus(issues: number) {
  const never = () => deferred<never>().promise;
  const work = new Workspace({ snapshot: never, catalog: never, sprints: never });
  work.query = { ...initialQuery, view: View.Today };
  const keys = Array.from({ length: issues }, (_, n) => `EX-${n + 1}`);
  const base = snapshot(work.query, keys);
  work.snapshot = {
    ...base,
    issues: base.issues.map((issue, n) => ({
      ...issue,
      section: "Assigned to you",
      // Only the last issue, far below the screen, has a long reason.
      reason: n === keys.length - 1 ? "updated 12d ago, blocked by EX-1" : "1d",
    })),
  };
  const client = { site: "example.atlassian.net", detail: never, attachment: never, findIssues: never };
  return new Dashboard(work, client, { open: async () => {}, copy: async () => {} }, () => {});
}

describe("issue rows", () => {
  test.each([
    [138, 1],
    [80, 2],
  ])("the toolbar has one blank row above and below it at width %i", (width, descriptionRow) => {
    const dashboard = teamFocus(30);
    dashboard.resize(width, 24);
    const canvas = frame(dashboard);
    const content = (row: number) =>
      canvas
        .text(row)
        .slice(width === 138 ? 20 : 0)
        .trim();
    expect(content(descriptionRow)).toBe("What needs attention across active sprints");
    expect(content(descriptionRow + 1)).toBe("");
    expect(content(descriptionRow + 2)).toMatch(/^Filter ▾ +Display ▾$/);
    expect(content(descriptionRow + 3)).toBe("");
    expect(content(descriptionRow + 4)).toContain("Issue");
  });

  test("columns hold still while scrolling: they are sized from the whole list", () => {
    const dashboard = teamFocus(30);
    dashboard.resize(138, 24);
    // Where the Activity column starts; a narrow one cuts its heading to "Ac…".
    const activity = () => frame(dashboard).text(5).indexOf("Ac");
    const before = activity();
    expect(before).toBeGreaterThan(0);
    dashboard.handle({ name: "end" }); // scroll the long reason into view
    expect(activity()).toBe(before);
  });
});
