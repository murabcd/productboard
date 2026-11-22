/** Workflow stages, and how a status and priority look in a list. */

import type { Issue } from "../jira/types";
import { type Stage, workflowStage } from "../jira/workflow";
import type { Style } from "./canvas";

export { STAGES, workflowStage as stage } from "../jira/workflow";

const STAGE_ICONS: Record<Stage, [icon: string, style: Style]> = {
  Blocked: ["⊘", "error"],
  "In progress": ["◐", "accent"],
  "In review": ["◑", "review"],
  "Ready for release": ["◕", "ship"],
  Done: ["●", "done"],
  "To do": ["○", "muted"],
  Backlog: ["◌", "muted"],
};

/** An issue's stage icon and color; the status text uses the same color. */
export const statusIcon = (issue: Pick<Issue, "status" | "category" | "stage">): [icon: string, style: Style] =>
  STAGE_ICONS[workflowStage(issue)];

const ACRONYMS = new Set(["QA", "QC", "UAT", "UI", "UX", "PR", "AI", "CI", "CD", "MVP"]);

/** Statuses in one casing: "IN REVIEW" reads as "In review", "IN QA" as "In QA".
 * Only all-caps names change; Jira's mixed-case names are kept as written. */
export function statusLabel(status: string): string {
  if (status !== status.toUpperCase() || status === status.toLowerCase()) return status;
  return status
    .split(" ")
    .map((word, i) => {
      if (ACRONYMS.has(word)) return word;
      const lower = word.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

/** Jira priority names by level, across the default and older schemes. */
const URGENT_PRIORITY = /highest|critical|blocker|urgent/;
const HIGH_PRIORITY = /high|major/;
const LOW_PRIORITY = /low|minor|trivial/;
const MEDIUM_PRIORITY = /medium|normal/;

/** A one-cell priority mark for the Pri column. */
export function priorityMark(priority: string): [mark: string, style: Style] {
  const name = priority.toLowerCase();
  if (URGENT_PRIORITY.test(name)) return ["!", "error"];
  if (HIGH_PRIORITY.test(name)) return ["↑", "warning"];
  if (LOW_PRIORITY.test(name)) return ["↓", "muted"];
  if (MEDIUM_PRIORITY.test(name)) return ["–", "muted"];
  return [" ", "muted"];
}
