import { describe, expect, test } from "bun:test";
import { rawComment, rawIssue } from "../testing";
import { type RawIssue, toComments, toIssue } from "./parse";
import { initialQuery, View } from "./query";
import { ago, today } from "./today";

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
  const base = rawIssue(key, options.category ?? "indeterminate", {
    person: options.assigned === false ? null : person,
  });
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
              inwardIssue: {
                key: options.blockedBy[0],
                fields: { status: { statusCategory: { key: options.blockedBy[1] } } },
              },
            },
          ]
        : [],
    },
  };
}

/** A search result updated three hours before NOW. */
function timed(key: string, category: "new" | "indeterminate" = "new", status?: string): RawIssue {
  const base = rawIssue(key, category);
  const name = status ?? base.fields.status.name;
  return {
    key,
    fields: {
      ...base.fields,
      status: { name, statusCategory: { key: category } },
      updated: "2026-11-09T09:00:00.000+0300",
    },
  };
}

function source(
  sprint: RawIssue[],
  extra: { flagged?: string[]; created?: string[]; assigned?: (string | RawIssue)[] } = {},
) {
  const searches: string[] = [];
  return {
    searches,
    search: async (jql: string) => {
      searches.push(jql);
      if (jql.includes("flagged = Impediment")) return (extra.flagged ?? []).map((key) => rawIssue(key));
      if (jql.includes("sprint in openSprints()")) return sprint;
      if (jql.includes("creator = currentUser()")) return (extra.created ?? []).map((key) => timed(key));
      return (extra.assigned ?? []).map((item) => (typeof item === "string" ? timed(item) : item));
    },
    mentions: async (jql: string) => {
      searches.push(jql);
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
          sprintIssue("EX-12", { status: "Ready for release", updated: "2026-11-02T10:00:00.000+0300" }),
          sprintIssue("EX-13", { status: "Ready for release" }),
          sprintIssue("EX-14", { status: "Dev Blocked", blockedBy: ["EX-92", "indeterminate"] }),
        ],
        { flagged: ["EX-2"] },
      ),
      query,
      { now: NOW },
    );
    expect(rows(result.issues)).toEqual([
      ["Blocked", "EX-1", undefined], // the status column already says "QA Blocked"
      ["Blocked", "EX-2", "Flagged"],
      ["Blocked", "EX-3", "blocked by EX-90"],
      ["Blocked", "EX-14", "blocked by EX-92"], // the cause beats the status
      ["Stuck", "EX-5", "10d no update"], // oldest first
      ["Stuck", "EX-4", "8d no update"], // its blocker is done
      ["Needs an owner", "EX-6", "No assignee"],
      ["Overdue", "EX-7", "due 11/05/2026"],
      ["Mentioned you", "EX-50", "Charlie · 9:00 AM"],
      ["Waiting for release", "EX-12", "7d waiting"], // done by the team, not stuck; EX-13 is too fresh
      ["Forgotten in active sprints", "EX-9", "677d no update"],
      ["Forgotten in active sprints", "EX-11", "69d no update"],
    ]);
  });

  test("an issue appears once, in its most urgent section", async () => {
    const result = await today(
      source([sprintIssue("EX-1", { status: "Dev Blocked" })], {
        created: ["EX-1", "EX-9"],
        assigned: ["EX-9", "EX-10"],
      }),
      query,
      { now: NOW },
    );
    expect(rows(result.issues)).toEqual([
      ["Blocked", "EX-1", undefined],
      ["Mentioned you", "EX-50", "Charlie · 9:00 AM"],
      ["Your issues, changed since yesterday", "EX-9", "updated 3h ago"],
      ["Assigned to you", "EX-10", "updated 3h ago"],
    ]);
  });

  test("your issues list work under way first and the backlog last", async () => {
    const result = await today(
      source([], { assigned: [timed("EX-1", "new", "Backlog"), timed("EX-2"), timed("EX-3", "indeterminate")] }),
      query,
      { now: NOW },
    );
    expect(result.issues.filter((i) => i.section === "Assigned to you").map((i) => i.key)).toEqual([
      "EX-3",
      "EX-2",
      "EX-1",
    ]);
  });

  test("project, sprint and assignee filters narrow every search, including mentions", async () => {
    const fake = source([]);
    await today(fake, { ...query, project: "EX", sprintFilter: 42, assignee: "dev" }, { now: NOW });
    expect(fake.searches).toHaveLength(5);
    for (const jql of fake.searches) {
      expect(jql).toContain('project = "EX"');
      expect(jql).toContain("sprint = 42");
      expect(jql).toContain('assignee = "dev"');
    }
  });

  test("the status filter narrows recent activity and skips open-only sections when set to Done", async () => {
    const open = source([]);
    await today(open, { ...query, status: "open" }, { now: NOW });
    expect(open.searches).toHaveLength(5);
    expect(open.searches.every((jql) => jql.includes("statusCategory != Done"))).toBe(true);

    const done = source([]);
    await today(done, { ...query, status: "done" }, { now: NOW });
    expect(done.searches).toHaveLength(2);
    expect(done.searches.every((jql) => jql.includes("statusCategory = Done"))).toBe(true);
  });
});

test("ago reads in minutes, hours, then days", () => {
  expect(ago(NOW - 5 * 60_000, NOW)).toBe("5m ago");
  expect(ago(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
  expect(ago(NOW - 6 * 86_400_000, NOW)).toBe("6d ago");
});
