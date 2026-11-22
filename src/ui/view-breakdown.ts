/** Every bucket carries its exact member rows, shared by chart counts and drilldowns. */
import type { Issue } from "../jira/types";
import type { Breakdown } from "../state/views";
import { STAGES, stage } from "./status";

export interface Bucket {
  id: string;
  label: string;
  issues: Issue[];
}
const DAY = 86_400_000;
const AGES = [
  { id: "0", label: "0–7 days", min: 0, max: 8 },
  { id: "8", label: "8–14 days", min: 8, max: 15 },
  { id: "15", label: "15–30 days", min: 15, max: 31 },
  { id: "31", label: "31+ days", min: 31, max: Infinity },
] as const;

export function breakdown(issues: readonly Issue[], kind: Breakdown, now = Date.now()): Bucket[] {
  if (kind === "status") {
    return STAGES.map((label) => ({
      id: label,
      label,
      issues: issues.filter((issue) => stage(issue) === label),
    }));
  }
  const open = issues.filter((issue) => issue.category !== "done");
  if (kind === "age") {
    const buckets: Bucket[] = AGES.map(({ id, label }) => ({ id, label, issues: [] }));
    const unknown: Bucket = { id: "unknown", label: "Unknown age", issues: [] };
    for (const issue of open) {
      const age = issue.created === undefined ? NaN : Math.floor((now - issue.created) / DAY);
      const index = AGES.findIndex(({ min, max }) => age >= min && age < max);
      (buckets[index] ?? unknown).issues.push(issue);
    }
    return unknown.issues.length ? [...buckets, unknown] : buckets;
  }
  const people = new Map<string, Bucket>();
  for (const issue of open) {
    const id = issue.assigneeId || "unassigned";
    const bucket = people.get(id) ?? { id, label: issue.assignee, issues: [] };
    bucket.issues.push(issue);
    people.set(id, bucket);
  }
  return [...people.values()].sort((a, b) => b.issues.length - a.issues.length || a.label.localeCompare(b.label));
}
