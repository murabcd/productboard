/** Shared catalog choices for workspace filters and saved-view drafts. */

import type { AssigneePerson } from "../jira/assignee";
import type { Choice, Issue } from "../jira/types";

export const projectChoices = (projects: Choice[]): Choice[] => [
  { value: "", label: "All projects", detail: "", state: "" },
  ...projects,
];

export function assigneeChoices(issues: readonly Issue[], selected: readonly AssigneePerson[] = []): Choice[] {
  const people = [
    ...new Map([
      ...selected.filter(({ id }) => id !== "unassigned").map(({ id, label }) => [id, label] as const),
      ...issues.filter((issue) => issue.assigneeId).map((issue) => [issue.assigneeId, issue.assignee] as const),
    ]),
  ].sort(([, a], [, b]) => a.localeCompare(b));
  return [
    { value: "unassigned", label: "Unassigned", detail: "", state: "" },
    ...people.map(([value, label]) => ({ value, label, detail: "", state: "" })),
  ];
}
