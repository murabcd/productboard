import { expect, mock, test } from "bun:test";
import { initialQuery, PAGE, View } from "../jira/query";
import { SavedView, SavedViews, type ViewDraft, viewQuery } from "./views";

const draft: ViewDraft = {
  name: "Team overview",
  board: "42",
  personLabel: "All people",
  breakdown: "status",
  scope: { view: View.Team, project: "EX", sprintFilter: 27, assignee: "", status: "all" },
};

test("saved scopes reset pagination and round-trip all filters without a local search", () => {
  const persist = mock(() => {});
  const views = new SavedViews({ save: persist });
  const created = views.save(draft, "team");
  expect(persist).toHaveBeenCalledWith([created]);
  const reopened = new SavedViews({ initial: [created], save: persist });
  expect(reopened.open("team")).toEqual(created);
  const query = viewQuery(created.scope);
  expect(query).toEqual({ ...draft.scope, text: "", limit: PAGE });
  expect(reopened.modified({ ...query, limit: PAGE * 2 }, "42")).toBe(false);
  expect(reopened.modified({ ...query, project: "OTHER" }, "42")).toBe(true);
  expect(reopened.modified(query, "other-board")).toBe(true);
  reopened.save({ ...draft, breakdown: "age" }, "team");
  expect(reopened.all).toHaveLength(1);
  expect(reopened.all[0]?.breakdown).toBe("age");
});

test("a failed local write leaves records and the active view intact", () => {
  const original = SavedView.parse({ ...draft, id: "team" });
  const views = new SavedViews({
    initial: [original],
    save: () => {
      throw new Error("disk full");
    },
  });
  views.open("team");
  expect(() => views.save({ ...draft, name: "Changed" }, "team")).toThrow("disk full");
  expect(() => views.remove("team")).toThrow("disk full");
  expect(views.current).toEqual(original);
  expect(views.all).toEqual([original]);
});

test("view validation sanitizes names, rejects unsupported scopes and invalid filters", () => {
  expect(SavedView.parse({ ...draft, id: "x", name: "  Sprint\u001b[31m health  " }).name).toBe("Sprint[31m health");
  expect(SavedView.safeParse({ ...draft, id: "x", scope: initialQuery }).success).toBe(true);
  for (const scope of [
    { ...draft.scope, view: View.Search },
    { ...draft.scope, sprintFilter: -1 },
  ]) {
    expect(SavedView.safeParse({ ...draft, id: "x", scope }).success).toBe(false);
  }
  expect(SavedView.safeParse({ ...draft, id: "x", name: " " }).success).toBe(false);
});
