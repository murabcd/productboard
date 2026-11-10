/** How each view groups and orders the loaded issues. */

import { period } from "../dates";
import { View } from "../jira/query";
import { type Issue, issueProject, type TodaySection } from "../jira/types";
import type { Style } from "./canvas";
import { STAGES, stage, statusIcon } from "./status";

export type Grouping = "status" | "assignee";
/** A heading's label, its issues, and the icon drawn before the label. */
export type Group = [label: string, issues: Issue[], icon: string, iconStyle: Style];
type Heading = [label: string, icon: string, iconStyle: Style];

/** Icons for Team focus sections. */
const SECTION_ICONS: Record<TodaySection, [icon: string, style: Style]> = {
  Blocked: ["⊘", "error"],
  Stuck: ["◐", "warning"],
  "Needs an owner": ["○", "muted"],
  Overdue: ["!", "warning"],
  "Mentioned you": ["@", "accent"],
  "Your issues, changed since yesterday": ["◇", "accent"],
  "Assigned to you": ["◫", "accent"],
  "Waiting for release": ["◕", "ship"],
  "Forgotten in active sprints": ["◌", "muted"],
};

/** Issues matching the search, grouped under their headings in first-seen order. */
function group(issues: Issue[], search: string, heading: (issue: Issue) => Heading): Group[] {
  const needle = search.toLocaleLowerCase();
  const groups = new Map<string, Group>();
  for (const issue of issues) {
    const haystack = `${issue.key} ${issue.summary} ${issue.status} ${issueProject(issue)} ${issue.assignee}`;
    if (needle && !haystack.toLocaleLowerCase().includes(needle)) continue;
    const [label, icon, iconStyle] = heading(issue);
    const existing = groups.get(label);
    if (existing) existing[1].push(issue);
    else groups.set(label, [label, [issue], icon, iconStyle]);
  }
  return [...groups.values()];
}

const CATEGORY_RANK = { indeterminate: 0, new: 1, done: 2 } as const;

/** In progress first, then not started, then done; stable within each. */
const byCategory = (issues: Issue[]): Issue[] =>
  issues.toSorted((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);

export function groupIssues(issues: Issue[], view: View, grouping: Grouping, search: string): Group[] {
  if (grouping === "assignee") {
    return group(byCategory(issues), search, (i) => [i.assignee, "◫", "accent"]).sort(([a], [b]) => a.localeCompare(b));
  }
  // Mentions arrive newest first; group by when you were mentioned.
  if (view === View.Mentions) return group(issues, search, (i) => [period(i.mention?.created ?? ""), "@", "accent"]);
  // Team focus arrives in section order, most urgent first.
  if (view === View.Today) {
    return group(issues, search, (i) => (i.section ? [i.section, ...SECTION_ICONS[i.section]] : ["", " ", "muted"]));
  }
  const rank = ([, [first]]: Group) => (first ? STAGES.indexOf(stage(first)) : 0);
  return group(issues, search, (i) => [stage(i), ...statusIcon(i)]).sort((a, b) => rank(a) - rank(b));
}
