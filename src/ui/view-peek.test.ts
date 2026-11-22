import { expect, mock, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { initialQuery, View } from "../jira/query";
import type { Issue } from "../jira/types";
import { Workspace } from "../state/workspace";
import { deferred, issues, snapshot } from "../testing";
import { cells } from "../text";
import { THEME_IDS } from "../theme";
import { Dashboard } from "./dashboard";
import { frame } from "./frame";
import { chartTop, FOOTER_ROWS, peekLayout, sidebarWidth } from "./layout";
import { useRenderer } from "./screen";
import { drawViewPeek } from "./view-peek";

function setup() {
  const never = mock(() => deferred<never>().promise);
  const work = new Workspace({ snapshot: never, boards: never, projects: never, sprints: never });
  work.query = { ...initialQuery, view: View.Team };
  const issue = issues("EX-1")[0];
  if (!issue) throw new Error("Missing issue fixture");
  const rows: Issue[] = Array.from({ length: 12 }, (_, i) => ({
    ...issue,
    key: `EX-${i + 1}`,
    stage: i < 10 ? "Blocked" : "In progress",
    category: "indeterminate",
    summary: `A long issue title ${i + 1} — Название задачи with enough text to wrap in the drawer`,
    assigneeId: i === 0 ? "" : `person-${i % 2}`,
    assignee: i === 0 ? "Unassigned" : "Same display name",
    reason: i === 0 ? "blocked by EX-99" : undefined,
  }));
  work.snapshot = { ...snapshot(work.query, []), issues: rows, more: true };
  const detail = mock(() => deferred<never>().promise);
  const d = new Dashboard(
    work,
    { site: "example.atlassian.net", detail, attachment: never, findIssues: never },
    { open: async () => {}, copy: async () => {} },
    () => {},
  );
  const view = d.views.saved.save({
    name: "Delivery",
    scope: { view: View.Team, project: "", sprintFilter: null, assignee: "", status: "all" },
    board: "",
    personLabel: "All people",
    breakdown: "status",
  });
  d.resize(156, 38);
  d.views.open(view.id);
  return { d, work, detail, never };
}

const text = (d: Dashboard) => {
  const canvas = frame(d);
  return Array.from({ length: canvas.height }, (_, y) => canvas.text(y)).join("\n");
};

test("Space previews exact loaded bar members without reads; selection updates the open drawer", async () => {
  const { d, work, detail, never } = setup();
  d.handle({ text: " " });
  const shown = text(d);
  expect(shown).toContain("Status peek");
  expect(shown).toContain("10 of 12 loaded · 83%");
  expect(shown).toContain("blocked by EX-99");
  expect(shown).toContain("Unassigned");
  // Different account IDs with the same display name remain separate owners.
  expect(shown.split("Same display name").length).toBeGreaterThan(2);
  const canvas = frame(d);
  const left = sidebarWidth(d.width) + peekLayout(d.width - sidebarWidth(d.width)).left;
  expect(canvas.targetAt(left + 2, chartTop(d.width) + 3)).toEqual({ kind: "peek" });
  d.handle({ name: "down", shift: true });
  expect(d.views.cursor).toBe(0);
  expect(d.views.peek?.scroll).toBe(3);
  d.wheel(1, { kind: "peek" });
  expect(d.views.peek?.scroll).toBe(6);
  d.handle({ name: "down" });
  expect(d.views.cursor).toBe(1);
  expect(d.views.peek?.scroll).toBe(0);
  expect(text(d)).toContain("2 of 12 loaded · 17%");
  expect(text(d)).toContain("EX-11");
  expect(text(d)).not.toContain("EX-1 ");
  work.snapshot = { ...snapshot(work.query, []), issues: work.issues.filter((issue) => issue.key !== "EX-11") };
  expect(text(d)).toContain("1 of 11 loaded · 9%");
  expect(text(d)).not.toContain("EX-11");
  expect(detail).not.toHaveBeenCalled();
  expect(never).not.toHaveBeenCalled();
  d.handle({ name: "escape" });
  expect(d.views.peek).toBeNull();
  expect(d.views.cursor).toBe(1);
  expect(d.views.chart).toBe(true);
  await d.dispose();
});

test("Enter and clicks drill down without opening hidden issue details; narrow Space opens the list", async () => {
  const { d, detail } = setup();
  d.click({ kind: "action", action: "peek" });
  expect(d.views.peek).not.toBeNull();
  expect(text(d)).toContain("Status peek");
  d.click({ kind: "action", action: "peek" });
  expect(d.views.peek).toBeNull();
  d.click({ kind: "action", action: "peek" });
  d.handle({ name: "enter" });
  expect(d.views.peek).toBeNull();
  expect(d.list.window(20).listed).toHaveLength(10);
  expect(d.peekOpen).toBe(false);
  d.handle({ name: "escape" });
  d.handle({ text: " " });
  d.click({ kind: "view-bucket", id: "In progress" });
  expect(d.views.peek).toBeNull();
  expect(d.list.window(20).listed.map((issue) => issue.key)).toEqual(["EX-11", "EX-12"]);
  d.handle({ name: "escape" });
  d.resize(80, 24);
  d.handle({ text: " " });
  expect(d.views.chart).toBe(false);
  expect(d.modal).toBeNull();
  expect(detail).not.toHaveBeenCalled();
  await d.dispose();
});

test("drawer resizes safely, clamps scroll after refresh, and closes on scope or breakdown changes", async () => {
  const { d, work } = setup();
  d.handle({ text: " " });
  for (let n = 0; n < 30; n++) d.wheel(1, { kind: "peek" });
  const long = text(d);
  expect(long).toContain("↑ more");
  expect(d.views.peek?.scroll).toBeGreaterThan(0);
  const before = d.views.peek;
  d.resize(80, 24);
  expect(d.views.peek).toBeNull();
  expect(text(d)).not.toContain("Status peek");
  d.resize(156, 38);
  expect(d.views.peek).toBe(before);
  work.snapshot = snapshot(work.query, []);
  expect(text(d)).toContain("No loaded issues in this bar");
  expect(d.views.peek?.scroll).toBe(0);
  d.views.chooseBreakdown("assignee");
  expect(d.views.peek).toBeNull();
  d.views.chooseBreakdown("status");
  d.handle({ text: " " });
  d.changeQuery({ project: "OTHER" });
  expect(d.views.peek).toBeNull();
  await d.dispose();
});

test("all breakdown previews wrap within the drawer and exclude completed work from open denominators", async () => {
  const { d, work } = setup();
  const first = work.issues[0];
  if (!first) throw new Error("Missing issue");
  work.snapshot = {
    ...snapshot(work.query, []),
    issues: [...work.issues, { ...first, key: "EX-DONE", category: "done", stage: "Done" }],
  };
  for (const kind of ["status", "assignee", "age"] as const) {
    d.views.chooseBreakdown(kind);
    const buckets = d.views.buckets;
    const bucket = buckets.find((item) => item.issues.length);
    if (!bucket) throw new Error("Missing bucket");
    if (kind !== "status") {
      d.handle({ text: " " });
      expect(text(d)).toContain("of 12 loaded");
      expect(text(d)).not.toContain("EX-DONE");
    }
    const state = { scroll: 0 };
    const canvas = drawViewPeek(bucket, kind, work.issues.length, state, 38, 12);
    for (let y = 0; y < canvas.height; y++) expect(cells(canvas.text(y))).toBe(38);
    expect(canvas.text(0)).toContain("peek");
    expect(canvas.targetAt(20, 5)).toEqual({ kind: "peek" });
  }
  await d.dispose();
});

test.each(THEME_IDS)("native OpenTUI opens and scrolls the chart drawer in %s", async (theme) => {
  const { d, detail } = setup();
  d.chooseTheme(theme);
  const terminal = await createTestRenderer({ width: 120, height: 24 });
  try {
    const screen = useRenderer(terminal.renderer, async () => {});
    void screen.show(d);
    await terminal.renderOnce();
    terminal.mockInput.pressKey(" ");
    await terminal.renderOnce();
    expect(terminal.captureCharFrame()).toContain("Status peek");
    terminal.mockInput.pressKey("ARROW_DOWN", { shift: true });
    await terminal.renderOnce();
    expect(d.views.cursor).toBe(0);
    expect(d.views.peek?.scroll).toBeGreaterThan(0);
    const canvas = frame(d);
    expect(canvas.text(d.height - 1)).toContain("Close peek");
    const top = chartTop(d.width);
    const drawer = peekLayout(d.width - sidebarWidth(d.width));
    expect(canvas.targetAt(sidebarWidth(d.width) + drawer.left, d.height - FOOTER_ROWS - 1)).toEqual({ kind: "peek" });
    expect(canvas.targetAt(sidebarWidth(d.width) + drawer.left, top - 1)?.kind).not.toBe("peek");
    expect(detail).not.toHaveBeenCalled();
  } finally {
    await d.dispose();
    await terminal.dispose();
  }
});
