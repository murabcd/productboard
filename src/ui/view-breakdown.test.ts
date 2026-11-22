import { expect, test } from "bun:test";
import { toIssue } from "../jira/parse";
import { rawIssue } from "../testing";
import { breakdown } from "./view-breakdown";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const DAY = 86_400_000;

test("age boundaries count open issues once, and preserve missing, invalid and future dates as unknown", () => {
  const rows = [0, 7, 8, 14, 15, 30, 31, 90].map((age, index) => ({
    ...toIssue(rawIssue(`EX-${index}`)),
    created: NOW - age * DAY,
  }));
  rows.push(
    { ...toIssue(rawIssue("EX-unknown")), created: NaN },
    { ...toIssue(rawIssue("EX-future")), created: NOW + DAY },
  );
  const missing = toIssue(rawIssue("EX-missing"));
  const done = toIssue(rawIssue("EX-done", "done"));
  const buckets = breakdown([...rows, missing, done], "age", NOW);
  expect(buckets.map((bucket) => [bucket.label, bucket.issues.length])).toEqual([
    ["0–7 days", 2],
    ["8–14 days", 2],
    ["15–30 days", 2],
    ["31+ days", 2],
    ["Unknown age", 3],
  ]);
  expect(new Set(buckets.flatMap((bucket) => bucket.issues.map((issue) => issue.key))).size).toBe(11);
});

test("assignees use account identity even when names match; done issues are excluded", () => {
  const rows = ["a", "b"].map((accountId, index) =>
    toIssue(
      rawIssue(`EX-${index}`, "new", {
        person: { accountId, displayName: "Same name" },
      }),
    ),
  );
  rows.push(toIssue(rawIssue("EX-3", "done")), toIssue(rawIssue("EX-4")));
  const buckets = breakdown(rows, "assignee");
  expect(buckets.map((bucket) => bucket.id).sort()).toEqual(["a", "b", "unassigned"]);
  expect(buckets.flatMap((bucket) => bucket.issues)).toHaveLength(3);
});

test("status counts and members use the same existing workflow classification", () => {
  const raw = rawIssue("EX-1");
  raw.fields.status.name = "Blocked";
  const rows = [toIssue(raw), toIssue(rawIssue("EX-2", "done"))];
  const buckets = breakdown(rows, "status");
  expect(buckets.find((bucket) => bucket.id === "Blocked")?.issues.map((issue) => issue.key)).toEqual(["EX-1"]);
  expect(buckets.find((bucket) => bucket.id === "Done")?.issues.map((issue) => issue.key)).toEqual(["EX-2"]);
  expect(buckets.flatMap((bucket) => bucket.issues)).toHaveLength(rows.length);
});

test("Jira creation timestamps normalize once at the read boundary", () => {
  const raw = rawIssue();
  raw.fields.created = "2026-11-22T15:00:00.000+0300";
  expect(toIssue(raw).created).toBe(NOW);
  raw.fields.created = "invalid";
  expect(toIssue(raw).created).toBeUndefined();
  delete raw.fields.created;
  expect(toIssue(raw).created).toBeUndefined();
});
