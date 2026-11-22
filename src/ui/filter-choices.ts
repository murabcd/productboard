/** Shared catalog choices for workspace filters and saved-view drafts. */
import type { Choice, Issue } from "../jira/types";

export const projectChoices = (projects: Choice[]): Choice[] => [
  { value: "", label: "All projects", detail: "", state: "" },
  ...projects,
];

export function assigneeChoices(issues: readonly Issue[]): Choice[] {
  const people = [
    ...new Map(issues.filter((issue) => issue.assigneeId).map((issue) => [issue.assigneeId, issue.assignee])),
  ].sort(([, a], [, b]) => a.localeCompare(b));
  return [
    { value: "", label: "All people", detail: "", state: "" },
    { value: "unassigned", label: "Unassigned", detail: "", state: "" },
    ...people.map(([value, label]) => ({ value, label, detail: "", state: "" })),
  ];
}
