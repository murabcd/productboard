import { expect, test } from "bun:test";
import { assignees } from "../testing";
import { AssigneeFilter } from "./assignee";
import { initialQuery, jql, sameScope, View, withAssignee, withView } from "./query";

test.each([
  ["include", [], "statusCategory IS NOT EMPTY"],
  ["exclude", [], "statusCategory IS NOT EMPTY"],
  ["include", ["alice", "bob"], 'assignee IN ("alice", "bob")'],
  ["include", ["alice", "unassigned"], '(assignee = "alice" OR assignee IS EMPTY)'],
  ["include", ["unassigned"], "assignee IS EMPTY"],
  ["exclude", ["alice"], '(assignee != "alice" OR assignee IS EMPTY)'],
  ["exclude", ["alice", "bob"], '(assignee NOT IN ("alice", "bob") OR assignee IS EMPTY)'],
  ["exclude", ["alice", "unassigned"], '(assignee != "alice" AND assignee IS NOT EMPTY)'],
  ["exclude", ["alice", "bob", "unassigned"], '(assignee NOT IN ("alice", "bob") AND assignee IS NOT EMPTY)'],
  ["exclude", ["unassigned"], "assignee IS NOT EMPTY"],
] as const)("%s %j uses Jira scope %s", (mode, ids, term) => {
  expect(jql({ ...initialQuery, view: View.Team, assignee: { ...assignees(...ids), mode } })).toBe(
    `${term} ORDER BY updated DESC`,
  );
});

test("exclusions are quoted, grouped with other filters, and ignore duplicate accounts", () => {
  const assignee = { ...assignees('alice" OR project=SECRET', "bob", "bob"), mode: "exclude" as const };
  expect(jql({ ...initialQuery, view: View.Created, project: "EX", status: "open", assignee })).toBe(
    'creator = currentUser() AND project = "EX" AND (assignee NOT IN ("alice\\" OR project=SECRET", "bob") OR assignee IS EMPTY) AND statusCategory != Done ORDER BY updated DESC',
  );
});

test("scope equality uses mode and account sets, ignoring display names and selection order", () => {
  const query = { ...initialQuery, assignee: assignees("alice", "bob") };
  expect(sameScope(query, { ...query, assignee: assignees("bob", "alice") })).toBe(true);
  expect(sameScope(query, { ...query, assignee: { ...query.assignee, mode: "exclude" } })).toBe(false);
  expect(sameScope(query, { ...query, assignee: assignees("alice") })).toBe(false);
  expect(
    sameScope(query, {
      ...query,
      assignee: {
        mode: "include",
        people: [
          { id: "alice", label: "Renamed" },
          { id: "bob", label: "Renamed" },
        ],
      },
    }),
  ).toBe(true);
  expect(sameScope(initialQuery, { ...initialQuery, assignee: { mode: "exclude", people: [] } })).toBe(true);
});

test("Assigned clears exclusions and applying them there transitions once to Team issues", () => {
  const assignee = { ...assignees("alice", "bob"), mode: "exclude" as const };
  const query = { ...initialQuery, view: View.Created, assignee, limit: 600 };
  const mine = withView(query, View.Mine);
  expect(mine.assignee.people).toEqual([]);
  expect(jql(mine)).toContain("assignee = currentUser()");
  expect(withAssignee(mine, assignee)).toMatchObject({ view: View.Team, assignee, limit: 200 });
  expect(withView(query, View.Today).assignee).toEqual(assignee);
});

test("saved filter validation deduplicates accounts, sanitizes labels and rejects invalid inputs", () => {
  expect(
    AssigneeFilter.parse({
      mode: "exclude",
      people: [
        { id: "alice", label: "old" },
        { id: "alice", label: "Alice\u0007" },
      ],
    }),
  ).toEqual({ mode: "exclude", people: [{ id: "alice", label: "Alice" }] });
  expect(AssigneeFilter.safeParse({ mode: "other", people: [] }).success).toBe(false);
  expect(AssigneeFilter.safeParse({ mode: "include", people: [{ id: "", label: "Alice" }] }).success).toBe(false);
});
