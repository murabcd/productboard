import { expect, mock, test } from "bun:test";
import { type IssueQuery, initialQuery, View } from "../jira/query";
import { type SavedView, type ViewDraft, viewQuery } from "../state/views";
import { Workspace } from "../state/workspace";
import { deferred, issues, settle, snapshot } from "../testing";
import { Dashboard } from "./dashboard";
import { frame } from "./frame";
import type { Key } from "./input";

const ENTER: Key = { name: "enter" };
const ESC: Key = { name: "escape" };
const CREATE: Key = { name: "agent-send-now" };
const draft: ViewDraft = {
  name: "Team overview",
  board: "42",
  personLabel: "All people",
  breakdown: "status",
  scope: { view: View.Team, project: "", sprintFilter: null, assignee: "", status: "all" },
};

function setup(save: (views: readonly SavedView[]) => void = mock(() => {})) {
  const requests: { query: IssueQuery; result: ReturnType<typeof deferred<ReturnType<typeof snapshot>>> }[] = [];
  const work = new Workspace({
    snapshot: (query) => {
      const result = deferred<ReturnType<typeof snapshot>>();
      requests.push({ query, result });
      return result.promise;
    },
    boards: async () => [],
    projects: async () => [],
    sprints: async () => [],
  });
  work.query = { ...initialQuery, view: View.Team };
  work.snapshot = snapshot(work.query, ["EX-1", "EX-2"]);
  work.board = "42";
  const detail = mock(async () => ({ facts: [], description: [], comments: [], attachments: [] }));
  const d = new Dashboard(
    work,
    {
      site: "example.atlassian.net",
      detail,
      attachment: async () => new Uint8Array(),
      findIssues: async () => [],
    },
    { open: async () => {}, copy: async () => {} },
    () => {},
    { views: { save } },
  );
  d.resize(140, 35);
  const view = d.views.saved.save(draft, "team");
  return { d, work, requests, detail, view };
}

function edit(d: Dashboard, text: string): void {
  const edit = d.searchEdit(d.layer());
  if (!edit) throw new Error("No active field");
  edit.change(text);
}

function choose(d: Dashboard, label: string): void {
  d.picker?.setQuery(label);
  const item = d.picker?.selected;
  if (!item || item.label !== label) throw new Error(`Missing choice ${label}`);
  d.click({ kind: "choice", value: item.value });
}

const text = (d: Dashboard) => {
  const canvas = frame(d);
  return Array.from({ length: canvas.height }, (_, row) => canvas.text(row)).join("\n");
};

test("creation isolates its draft, validates the name, and returns from nested pickers", async () => {
  const { d, work } = setup();
  const query = work.query;
  d.runAction("new-view");
  expect(d.layer().kind).toBe("view-form");
  d.handle(CREATE);
  expect(d.views.form?.error).toBe("Enter a view name");
  edit(d, "Sprint health");
  d.handle({ name: "tab" });
  d.handle(ENTER);
  choose(d, "My issues");
  expect(d.views.form?.draft.scope.view).toBe(View.Mine);
  expect(work.query).toBe(query);
  d.views.field("breakdown");
  choose(d, "Open issue age");
  d.views.field("project");
  d.handle(ESC);
  expect(d.layer().kind).toBe("view-form");
  d.handle(CREATE);
  expect(d.views.current).toMatchObject({ name: "Sprint health", breakdown: "age" });
  expect(work.query.view).toBe(View.Mine);
  expect(d.views.chart).toBe(true);
  expect(d.views.saved.all).toHaveLength(2);
  await d.dispose();
});

test("chart drilldown shares list membership after refresh and Esc closes peek before returning to chart", async () => {
  const { d, work, detail } = setup();
  d.views.open("team");
  const bucket = d.views.buckets.find((bucket) => bucket.id === "To do");
  expect(bucket?.issues).toHaveLength(2);
  d.click({ kind: "view-bucket", id: "To do" });
  expect(d.list.window(20).listed.map((issue) => issue.key)).toEqual(["EX-1", "EX-2"]);
  d.handle({ text: " " });
  expect(d.peekOpen).toBe(true);
  expect(detail).toHaveBeenCalledTimes(1);
  d.handle(ESC);
  expect(d.peekOpen).toBe(false);
  expect(d.views.chart).toBe(false);
  const rows = issues("EX-1", "EX-3");
  work.snapshot = { ...snapshot(work.query, []), issues: rows };
  expect(d.list.window(20).listed.map((issue) => issue.key)).toEqual(["EX-1", "EX-3"]);
  d.handle(ESC);
  expect(d.views.chart).toBe(true);
  expect(d.views.buckets.find((bucket) => bucket.id === "To do")?.issues).toHaveLength(2);
  d.handle({ text: "2" });
  expect(d.agent.tab).toBe(true);
  expect(d.views.active).toBeUndefined();
  await d.dispose();
});

test("one saved destination is active; modified settings update the same record and survive reopening", async () => {
  const { d, work } = setup();
  d.views.open("team");
  expect(text(d)).not.toContain("Save changes");
  const canvas = frame(d);
  const teamRow = Array.from({ length: canvas.height }, (_, i) => i).find((row) =>
    canvas.text(row).includes("Team issues"),
  );
  expect(teamRow).toBeDefined();
  d.changeQuery({ project: "EX" });
  expect(d.views.saved.modified(work.query, work.board)).toBe(true);
  expect(text(d)).toContain("Save changes");
  d.views.chooseBreakdown("assignee");
  d.views.saveChanges();
  expect(d.views.saved.all).toHaveLength(1);
  expect(d.views.current).toMatchObject({ id: "team", breakdown: "assignee", scope: { project: "EX" } });
  d.showPage(View.Mine);
  d.views.open("team");
  expect(work.query).toEqual(viewQuery({ ...draft.scope, project: "EX" }));
  expect(d.views.active?.breakdown).toBe("assignee");
  await d.dispose();
});

test("charts disclose loaded counts, keep last data on failure, and reject old scope data", async () => {
  const { d, work, requests } = setup();
  d.views.open("team");
  work.snapshot = snapshot(work.query, ["EX-1", "EX-2"], true);
  expect(text(d)).toContain("2 loaded · more available");
  work.refresh();
  requests[0]?.result.reject(new Error("Offline"));
  await settle();
  expect(d.views.buckets.flatMap((bucket) => bucket.issues)).toHaveLength(2);
  expect(text(d)).toContain("Showing the last list");
  d.changeQuery({ project: "OTHER" });
  expect(d.views.buckets.flatMap((bucket) => bucket.issues)).toHaveLength(0);
  requests[1]?.result.resolve(snapshot(work.query, ["OTHER-1"]));
  await settle();
  expect(d.views.buckets.flatMap((bucket) => bucket.issues).map((issue) => issue.key)).toEqual(["OTHER-1"]);
  await d.dispose();
});

test("creation failures remain editable and minimum-size dialogs keep visible action hints", async () => {
  let fail = false;
  const { d } = setup(() => {
    if (fail) throw new Error("disk full");
  });
  fail = true;
  d.runAction("new-view");
  edit(d, "New view");
  d.handle(CREATE);
  expect(d.views.form?.error).toContain("disk full");
  expect(d.views.saved.all).toHaveLength(1);
  for (const [width, height] of [
    [60, 18],
    [96, 24],
    [140, 35],
  ]) {
    d.resize(width ?? 60, height ?? 18);
    expect(text(d)).toContain("^↵ Create view");
  }
  d.handle(ESC);
  expect(d.views.form).toBeNull();
  await d.dispose();
});

test("chart shortcuts cannot open invisible issues, refresh clamps the highlighted assignee, and drilldowns name their bucket", async () => {
  const { d, work, detail } = setup();
  d.views.open("team");
  for (const key of [" ", "v", "o", "y"]) d.handle({ text: key });
  expect(d.peekOpen).toBe(false);
  expect(d.modal).toBeNull();
  expect(detail).not.toHaveBeenCalled();
  work.snapshot = {
    ...snapshot(work.query, []),
    issues: Array.from({ length: 20 }, (_, index) => ({
      key: `EX-${index}`,
      summary: "Task",
      status: "To do",
      category: "new" as const,
      priority: "",
      sprint: "",
      assigneeId: `person-${index}`,
      assignee: `Person ${index}`,
    })),
  };
  d.views.chooseBreakdown("assignee");
  d.handle({ name: "end" });
  expect(d.views.cursor).toBe(19);
  work.snapshot = snapshot(work.query, ["EX-1"]);
  expect(d.views.cursor).toBe(0);
  d.handle(ENTER);
  expect(d.list.window(20).listed).toHaveLength(1);
  expect(text(d)).toContain("Team overview · Unassigned");
  await d.dispose();
});

test("opening a saved view changes page, filters, board and sprint in one Jira request", async () => {
  const { d, work, requests } = setup();
  work.query = { ...initialQuery, view: View.Mine, project: "OLD", sprintFilter: 11 };
  work.board = "old";
  const saved = d.views.saved.save({ ...draft, scope: { ...draft.scope, project: "NEW", sprintFilter: 27 } }, "new");
  d.views.open(saved.id);
  expect(requests.map((request) => request.query)).toEqual([viewQuery(saved.scope)]);
  expect(work.board).toBe("42");
  expect(d.views.current?.id).toBe("new");
  await d.dispose();
});

test("returning to a chart or opening a saved view clears drilldown-only text filters", async () => {
  const { d } = setup();
  d.list.filter("hidden old filter");
  d.views.open("team");
  d.views.drill("To do");
  expect(d.list.window(20).listed).toHaveLength(2);
  d.list.filter("EX-1");
  expect(d.list.window(20).listed).toHaveLength(1);
  d.views.back();
  expect(d.list.search).toBe("");
  d.views.drill("To do");
  expect(d.list.window(20).listed).toHaveLength(2);
  await d.dispose();
});
