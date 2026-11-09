import { describe, expect, test } from "bun:test";
import { rawComment, rawIssue } from "../testing";
import { toComments, toIssue, type RawIssue } from "./parse";
import { initialQuery, View } from "./query";
import { today } from "./today";

const NOW = Date.parse("2026-11-09T12:00:00+03:00");
const person = { accountId: "dev", displayName: "Cameron" };

/** A sprint issue with the fields Today reads. */
function sprintIssue(
  key: string,
  options: {
    status?: string;
    category?: "new" | "indeterminate";
    updated?: string;
    assigned?: boolean;
    due?: string;
    blockedBy?: [string, "done" | "indeterminate"];
  } = {},
): RawIssue {
  const base = rawIssue(key, options.category ?? "indeterminate", { person: options.assigned === false ? null : person });
  return {
    key,
    fields: {
      ...base.fields,
      status: { name: options.status ?? "In Progress", statusCategory: { key: options.category ?? "indeterminate" } },
      updated: options.updated ?? "2026-11-09T10:00:00.000+0300",
      duedate: options.due ?? null,
      issuelinks: options.blockedBy
        ? [
            {
              type: { name: "Blocks" },
              inwardIssue: { key: options.blockedBy[0], fields: { status: { statusCategory: { key: options.blockedBy[1] } } } },
            },
          ]
        : [],
    },
  };
}

function source(sprint: RawIssue[], extra: { flagged?: string[]; created?: string[]; assigned?: string[] } = {}) {
  const searches: string[] = [];
  return {
    searches,
    search: async (jql: string) => {
      searches.push(jql);
      if (jql.includes("flagged = Impediment")) return (extra.flagged ?? []).map((key) => rawIssue(key));
      if (jql.includes("sprint in openSprints()")) return sprint;
      if (jql.includes("creator = currentUser()")) return (extra.created ?? []).map((key) => rawIssue(key));
      return (extra.assigned ?? []).map((key) => rawIssue(key));
    },
    mentions: async () => {
      const mention = toComments([rawComment("Check ", "2026-11-09T09:00:00.000+0300", "me")], "me")[0];
      return { issues: [{ ...toIssue(rawIssue("EX-50")), mention }], more: false, scanned: 1 };
    },
  };
}

const query = { ...initialQuery, view: View.Today };
const rows = (issues: { key: string; section?: string; reason?: string }[]) =>
  issues.map((i) => [i.section, i.key, i.reason]);

describe("Today", () => {
  test("sorts sprint work into blocked, stuck, unowned and overdue with reasons", async () => {
    const result = await today(
      source(
        [
          sprintIssue("EX-1", { status: "QA Blocked" }),
          sprintIssue("EX-2"),
          sprintIssue("EX-3", { blockedBy: ["EX-90", "indeterminate"] }),
          sprintIssue("EX-4", { blockedBy: ["EX-91", "done"], updated: "2026-11-01T10:00:00.000+0300" }),
          sprintIssue("EX-5", { updated: "2026-10-30T10:00:00.000+0300" }),
          sprintIssue("EX-6", { category: "new", assigned: false }),
          sprintIssue("EX-7", { category: "new", due: "2026-11-05" }),
          sprintIssue("EX-8", { category: "new" }),
          sprintIssue("EX-9", { status: "Dev Blocked", updated: "2025-01-01T10:00:00.000+0300" }),
          sprintIssue("EX-11", { category: "new", updated: "2026-09-01T10:00:00.000+0300" }),
        ],
        { flagged: ["EX-2"] },
      ),
      query,
      NOW,
    );
    expect(rows(result.issues)).toEqual([
      ["Blocked", "EX-1", undefined], // the status column already says "QA Blocked"
      ["Blocked", "EX-2", "Flagged"],
      ["Blocked", "EX-3", "blocked by EX-90"],
      ["Stuck", "EX-5", "10 days without update"], // oldest first
      ["Stuck", "EX-4", "8 days without update"], // its blocker is done
      ["Needs an owner", "EX-6", "No assignee"],
      ["Overdue", "EX-7", "due 2026-11-05"],
      ["Mentioned you", "EX-50", "Charlie mentioned you"],
      ["Forgotten in active sprints", "EX-9", "677 days without update"],
      ["Forgotten in active sprints", "EX-11", "69 days without update"],
    ]);
  });

  test("an issue appears once, in its most urgent section", async () => {
    const result = await today(source([sprintIssue("EX-1", { status: "Dev Blocked" })], { created: ["EX-1", "EX-9"], assigned: ["EX-9", "EX-10"] }), query, NOW);
    expect(rows(result.issues)).toEqual([
      ["Blocked", "EX-1", undefined],
      ["Mentioned you", "EX-50", "Charlie mentioned you"],
      ["Your issues, changed since yesterday", "EX-9", "now Custom new"],
      ["Assigned to you", "EX-10", "Custom new"],
    ]);
  });

  test("the project filter narrows every search", async () => {
    const fake = source([]);
    await today(fake, { ...query, project: "EX" }, NOW);
    expect(fake.searches.length).toBe(4);
    for (const jql of fake.searches) expect(jql).toContain('project = "EX"');
  });
});
