import { expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { toIssue } from "../jira/parse";
import { initialQuery, View } from "../jira/query";
import type { Issue } from "../jira/types";
import { STAGES } from "../jira/workflow";
import { Workspace } from "../state/workspace";
import { deferred, rawIssue, snapshot } from "../testing";
import { THEME_IDS, THEMES } from "../theme";
import { Canvas } from "./canvas";
import { Dashboard } from "./dashboard";
import { useRenderer } from "./screen";
import { breakdown } from "./view-breakdown";
import { drawViewChart } from "./view-chart";

const issue = toIssue(rawIssue());
const rows: Issue[] = STAGES.flatMap((stage, index) =>
  Array.from({ length: index === 0 ? 100 : 1 }, (_, n) => ({
    ...issue,
    key: `EX-${index}-${n}`,
    summary: stage,
    status: stage,
    category: stage === "Done" ? ("done" as const) : ("indeterminate" as const),
    stage,
  })),
);

test("square bars keep small counts visible in compact consecutive rows", () => {
  const canvas = new Canvas(60, 24);
  drawViewChart(canvas, 0, breakdown(rows, "status"), "status", 2);
  for (const [index, stage] of STAGES.entries()) {
    const y = 4 + index;
    expect(canvas.text(y)).toContain("■");
    expect(canvas.text(y)).not.toContain("▏");
    expect(canvas.targetAt(30, y)).toEqual({ kind: "view-bucket", id: stage });
  }
  const selected = canvas.runs(6).find((run) => run.text.includes("■"));
  expect(selected).toMatchObject({ style: "review", surface: "selected" });
  const empty = new Canvas(60, 18);
  drawViewChart(empty, 6, breakdown([], "status"), "status", 0);
  expect(empty.text(10)).toContain("No loaded issues");
  expect(empty.text(15).trim()).toBe("");
  expect(empty.targetAt(30, 15)).toBeUndefined();
});

test("compact charts scroll the selected bucket above the footer at minimum terminal size", () => {
  const canvas = new Canvas(60, 18);
  const people = Array.from({ length: 20 }, (_, index) => ({
    ...issue,
    key: `EX-${index}`,
    summary: "Task",
    status: "To do",
    category: "new" as const,
    assigneeId: `person-${index}`,
    assignee: `Person ${String(index).padStart(2, "0")}`,
  }));
  const buckets = breakdown(people, "assignee");
  drawViewChart(canvas, 6, buckets, "assignee", 19);
  expect(canvas.text(15)).toContain("Person 19");
  expect(canvas.targetAt(30, 15)).toEqual({ kind: "view-bucket", id: "person-19" });
  expect(canvas.text(16).trim()).toBe("");
  expect(canvas.text(17).trim()).toBe("");
  const ages = new Canvas(80, 24);
  const now = Date.now();
  drawViewChart(
    ages,
    0,
    breakdown(
      [0, 8, 15, 31, NaN].map((age) => ({
        ...issue,
        key: `AGE-${age}`,
        created: now - age * 86400000,
      })),
      "age",
      now,
    ),
    "age",
    0,
  );
  expect([4, 5, 6, 7, 8].map((y) => ages.runs(y).find((run) => run.text.includes("■"))?.style)).toEqual([
    "done",
    "accent",
    "review",
    "error",
    "muted",
  ]);
});

test.each(THEME_IDS)("OpenTUI preserves chart colors and compact click targets in %s", async (theme) => {
  const terminal = await createTestRenderer({ width: 120, height: 35 });
  const never = () => deferred<never>().promise;
  const work = new Workspace({ snapshot: never, boards: never, projects: never, sprints: never });
  work.query = { ...initialQuery, view: View.Team };
  work.snapshot = { ...snapshot(work.query, []), issues: rows };
  const d = new Dashboard(
    work,
    { site: "example.atlassian.net", detail: never, attachment: never, findIssues: never },
    { open: async () => {}, copy: async () => {} },
    () => {},
    { appearance: { initial: theme, save: () => {} } },
  );
  try {
    const saved = d.views.saved.save({
      name: "Chart",
      board: "",
      personLabel: "All people",
      breakdown: "status",
      scope: { view: View.Team, project: "", sprintFilter: null, assignee: "", status: "all" },
    });
    d.views.open(saved.id);
    const screen = useRenderer(terminal.renderer, async () => {});
    void screen.show(d);
    await terminal.renderOnce();
    const captured = terminal.captureSpans();
    const colored = captured.lines.filter((line) => line.spans.some((span) => span.text.includes("■")));
    const palette = THEMES[theme];
    expect(colored).toHaveLength(7);
    const expected = [
      palette.error,
      palette.accent,
      palette.review,
      palette.ship,
      palette.done,
      palette.muted,
      palette.muted,
    ];
    colored.forEach((line, index) => {
      const bar = line.spans.find((span) => span.text.includes("■"));
      expect(bar?.fg.equals(RGBA.fromHex(expected[index] ?? ""))).toBe(true);
    });
    const reviewRow = terminal
      .captureCharFrame()
      .split("\n")
      .findIndex((line) => line.includes("In review"));
    await terminal.mockMouse.click(55, reviewRow);
    expect(d.views.active?.bucket).toBe("In review");
    expect(d.list.window(20).listed.map((issue) => issue.stage)).toEqual(["In review"]);
  } finally {
    await d.dispose();
    await terminal.dispose();
  }
});
