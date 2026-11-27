import { describe, expect, test } from "bun:test";
import { ALL_ASSIGNEES } from "../jira/assignee";
import { initialQuery, View } from "../jira/query";
import { Workspace } from "../state/workspace";
import { deferred, snapshot } from "../testing";
import { Dashboard } from "./dashboard";
import { layout } from "./document";
import { frame } from "./frame";
import { helpPanel } from "./panel";

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
  test.each([32, 48])("phone sprint actions stay reachable through More at width %i", (width) => {
    const d = teamFocus(3);
    d.workspace.query = { ...initialQuery, view: View.Team, sprintFilter: 7 };
    d.workspace.sprints = [{ id: 7, name: "Sprint 7", state: "active", start: "", end: "", goal: "Ship" }];
    d.resize(width, 24);
    const canvas = frame(d);
    const column = canvas.text(4).indexOf("More");
    expect(column).toBeGreaterThan(0);
    d.click(canvas.targetAt(column, 4));
    expect(d.picker?.kind).toBe("commands");
    d.picker?.setQuery("Display options");
    d.handle({ name: "enter" });
    expect(d.picker?.kind).toBe("display");
    d.openPicker("commands");
    d.picker?.setQuery("Sprint brief");
    d.handle({ name: "enter" });
    expect(d.modal?.kind).toBe("text");
  });

  test("phone shortcut explanations wrap instead of losing navigation instructions", () => {
    const help = helpPanel();
    if (help.kind !== "text") throw new Error("Expected text help");
    const text = layout(help.body, 27)
      .map((line) => line.map((run) => run.text).join(""))
      .join(" ");
    expect(text).toContain("Group by status / assignee");
    expect(text).toContain("Search all of Jira");
  });

  test.each([32, 48])("filtered phone charts keep their breakdown available at width %i", (width) => {
    const d = teamFocus(3);
    d.workspace.query = { ...initialQuery, view: View.Team };
    const view = d.views.saved.save({
      name: "Delivery",
      board: "",
      breakdown: "status",
      scope: { ...d.workspace.query, view: View.Team },
    });
    d.views.open(view.id);
    d.workspace.query = { ...d.workspace.query, project: "Example project with a long name", status: "open" };
    d.resize(width, 24);
    d.openPicker("commands");
    d.picker?.setQuery("Change breakdown");
    expect(d.picker?.selected?.label).toBe("Change breakdown");
    d.handle({ name: "enter" });
    expect(d.picker?.kind).toBe("view-breakdown");
  });

  test.each([32, 40, 48, 59])("phone rows keep issue identity and summary visible at width %i", (width) => {
    const dashboard = teamFocus(30);
    dashboard.resize(width, 39);
    const canvas = frame(dashboard);
    const text = Array.from({ length: canvas.height }, (_, row) => canvas.text(row)).join("\n");
    expect(text).not.toContain("make this pane");
    expect(text).toContain("Team issues ▾");
    const keyRow = text.split("\n").findIndex((row) => row.includes("EX-1"));
    expect(keyRow).toBeGreaterThan(4);
    expect(canvas.text(keyRow + 1)).toContain("Рабочая задача");
    expect(canvas.targetAt(5, keyRow + 1)).toEqual({ kind: "issue", key: "EX-1" });
    dashboard.handle({ name: "pagedown" });
    const selected = dashboard.list.selected?.key;
    expect(selected).not.toBe("EX-1");
    dashboard.handle({ name: "end" });
    const last = frame(dashboard);
    const lastKeyRow = Array.from({ length: last.height }, (_, row) => last.text(row)).findIndex((row) =>
      row.includes("EX-30"),
    );
    expect(lastKeyRow).toBeGreaterThan(4);
    expect(last.text(lastKeyRow + 1)).toContain("Рабочая задача");
    expect(lastKeyRow + 1).toBeLessThan(37);
    dashboard.resize(138, 39);
    expect(dashboard.list.selected?.key).toBe("EX-30");
    expect(frame(dashboard).text(0)).toContain("PRODUCTBOARD");
  });

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
      breakdown: "status",
      scope: { view: View.Team, project: "", sprintFilter: null, assignee: ALL_ASSIGNEES, status: "all" },
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
    expect(content(descriptionRow + 6)).toContain("Blocked");
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
