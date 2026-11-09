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
