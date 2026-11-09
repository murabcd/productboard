/** How each view groups and orders the loaded issues. */

import { View } from "../jira/query";
import { type Issue, issueProject } from "../jira/types";

export type Grouping = "status" | "assignee";
export type Group = [label: string, issues: Issue[]];

const CATEGORY_RANK = { indeterminate: 0, new: 1, done: 2 } as const;

/** In progress first, then not started, then done; stable within each. */
const byCategory = (issues: Issue[]): Issue[] =>
  issues.toSorted((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);

/** Issues matching the search, grouped by label in first-seen order. */
function group(issues: Issue[], search: string, label: (issue: Issue) => string): Group[] {
  const needle = search.toLocaleLowerCase();
  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    const haystack = `${issue.key} ${issue.summary} ${issue.status} ${issueProject(issue)} ${issue.assignee}`;
    if (needle && !haystack.toLocaleLowerCase().includes(needle)) continue;
    const name = label(issue);
    groups.set(name, [...(groups.get(name) ?? []), issue]);
  }
  return [...groups];
}

export function groupIssues(issues: Issue[], view: View, grouping: Grouping, search: string): Group[] {
  if (grouping === "assignee") {
    return group(byCategory(issues), search, (i) => i.assignee).sort(([a], [b]) => a.localeCompare(b));
  }
  if (view === View.Mentions) {
    // Already newest mention first; group by the day you were mentioned.
    return group(issues, search, (i) => `Mentioned ${i.mention?.created.slice(0, 10) ?? ""}`);
  }
  // Today arrives in section order, most urgent first.
  if (view === View.Today) return group(issues, search, (i) => i.section ?? "");
  return group(byCategory(issues), search, (i) => i.status);
}
