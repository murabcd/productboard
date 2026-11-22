import { describe, expect, test } from "bun:test";
import { initialQuery, View } from "../jira/query";
import { Workspace } from "../state/workspace";
import { deferred, snapshot } from "../testing";
import { Dashboard } from "./dashboard";
import { frame } from "./frame";

function teamFocus(issues: number) {
  const never = () => deferred<never>().promise;
  const work = new Workspace({ snapshot: never, boards: never, projects: never, sprints: never });
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
  test("partial attention results keep their rows and show the missing data sources", () => {
    const dashboard = teamFocus(1);
    if (dashboard.workspace.snapshot) dashboard.workspace.snapshot.warnings = ["Flagged issues unavailable"];
    dashboard.resize(138, 24);
    const canvas = frame(dashboard);
    const text = Array.from({ length: canvas.height }, (_, row) => canvas.text(row)).join("\n");
    expect(text).toContain("EX-1");
    expect(text).toContain("Partial results · Flagged issues unavailable · r retry");
  });

  test.each([
    [138, 1],
    [80, 2],
    [60, 2],
  ])("team filters follow the tabs and wrap only when needed at width %i", (width, descriptionRow) => {
    const dashboard = teamFocus(30);
    dashboard.resize(width, 24);
    if (width === 60) {
      dashboard.workspace.query = { ...dashboard.workspace.query, status: "done" };
      if (dashboard.workspace.snapshot) dashboard.workspace.snapshot.query = dashboard.workspace.query;
    }
    const canvas = frame(dashboard);
    const content = (row: number) =>
      canvas
        .text(row)
        .slice(width === 138 ? 20 : 0)
        .trim();
    expect(content(descriptionRow)).toBe("What needs attention in the selected scope");
    if (width === 60) {
      expect(content(descriptionRow + 1)).toBe("All issues   Needs attention");
      expect(content(descriptionRow + 2)).toMatch(/^Filter 1 ▾ +Status: Done +Display ▾$/);
    } else {
      expect(content(descriptionRow + 1)).toBe("");
      expect(content(descriptionRow + 2)).toMatch(/^All issues +Needs attention +Filter ▾ +Display ▾$/);
    }
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

  test.each([
    [138, 1],
    [80, 2],
    [60, 2],
  ])("saved views share page descriptions and single blank row gaps at width %i", async (width, descriptionRow) => {
    const dashboard = teamFocus(3);
    const work = dashboard.workspace;
    work.query = { ...initialQuery, view: View.Team };
    if (work.snapshot) work.snapshot.query = work.query;
    const view = dashboard.views.saved.save({
      name: "Delivery",
      board: "",
      personLabel: "All people",
      breakdown: "status",
      scope: { view: View.Team, project: "", sprintFilter: null, assignee: "", status: "all" },
    });
    dashboard.resize(width, 24);
    dashboard.views.open(view.id);
    const content = (row: number) =>
      frame(dashboard)
        .text(row)
        .slice(width === 138 ? 20 : 0)
        .trim();
    expect(content(descriptionRow)).toBe("Loaded issues grouped by status");
    expect(content(descriptionRow + 1)).toBe("");
    expect(content(descriptionRow + 2)).toContain("Filter ▾");
    expect(content(descriptionRow + 3)).toBe("");
    expect(content(descriptionRow + 4)).toBe("Open 3   Done 0");
    expect(content(descriptionRow + 5)).toBe("");
    expect(content(descriptionRow + 6)).toBe("Work by status");
    expect(content(descriptionRow + 7)).toBe("");
    expect(content(descriptionRow + 8)).toContain("Blocked");
    dashboard.views.chooseBreakdown("assignee");
    expect(content(descriptionRow)).toBe("Open issues grouped by assignee");
    dashboard.views.chooseBreakdown("age");
    expect(content(descriptionRow)).toBe("Open issues grouped by time since creation");
    dashboard.views.drill("unknown");
    expect(content(descriptionRow)).toBe("Loaded issues in the selected group");
    await dashboard.dispose();
  });

  test("Peek leaves one workspace column outside its paint and scroll target", () => {
    const dashboard = teamFocus(30);
    dashboard.resize(138, 24);
    dashboard.handle({ text: " " });
    const canvas = frame(dashboard);
    const top = 6;
    expect(canvas.text(top)).toContain("Issue peek");
    for (let row = top; row < canvas.height - 2; row++) {
      expect(canvas.runs(row).at(-1)).toMatchObject({ text: " ", surface: "workspace" });
      expect(canvas.targetAt(canvas.width - 2, row)).toEqual({ kind: "peek" });
      expect(canvas.targetAt(canvas.width - 1, row)).toBeUndefined();
    }
  });
});
