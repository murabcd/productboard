/** Status colors by workflow stage, so a list reads at a glance. */

import type { Issue } from "../jira/types";
import type { Style } from "./canvas";

/** Blocked, in review or QA, and ready to ship stand out from Jira's
 * three categories: to do (grey), in progress (blue) and done (green). */
export function statusStyle({ status, category }: Pick<Issue, "status" | "category">): Style {
  if (/blocked/i.test(status)) return "error";
  // Icebox counts as done in Jira, but the work was parked, not finished.
  if (/icebox/i.test(status)) return "muted";
  if (category === "done") return "done";
  if (/review|\bqa\b/i.test(status)) return "review";
  if (/ready for release/i.test(status)) return "ship";
  return category === "indeterminate" ? "accent" : "muted";
}

/** A Linear-style icon for the stage, drawn in the same color as the status. */
export function statusGlyph(issue: Pick<Issue, "status" | "category">): string {
  const style = statusStyle(issue);
  if (style === "error") return "⊘";
  if (style === "done") return "●";
  if (style === "ship") return "◕";
  if (style === "review") return "◑";
  if (style === "accent") return "◐";
  return /backlog|icebox/i.test(issue.status) ? "◌" : "○";
}

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

/** A one-cell priority mark; Jira's default (Medium) stays blank so the others stand out. */
export function priorityMark(priority: string): [mark: string, style: Style] {
  const name = priority.toLowerCase();
  if (/highest|critical|blocker|urgent/.test(name)) return ["!", "error"];
  if (/high|major/.test(name)) return ["↑", "warning"];
  if (/low|minor|trivial/.test(name)) return ["↓", "muted"];
  return [" ", "muted"];
}
