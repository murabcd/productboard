/** Site-specific workflow names, with Jira's status categories as the baseline. */

import { z } from "zod";
import type { Category } from "./types";

export const Stage = z.enum(["Blocked", "In progress", "In review", "Ready for release", "Done", "To do", "Backlog"]);
export type Stage = z.infer<typeof Stage>;
export const STAGES = Stage.options;

export const Workflow = z.object({
  statuses: z.record(z.string(), Stage).default({}),
  blockedLinkTypes: z.array(z.string().min(1)).default(["Blocks"]),
});
export type Workflow = z.infer<typeof Workflow>;
export const DEFAULT_WORKFLOW = Workflow.parse({});

const BLOCKED = /\bblocked\b/i;
const BACKLOG = /\b(backlog|icebox)\b/i;
const REVIEW = /\breview\b|\bqa\b/i;
const RELEASE = /\bready for release\b/i;

/** Done remains authoritative; custom names can refine the other categories. */
export function workflowStage(
  { status, category, stage }: { status: string; category: Category; stage?: Stage },
  workflow: Workflow = DEFAULT_WORKFLOW,
): Stage {
  if (category === "done") return "Done";
  if (stage) return stage;
  const name = status.trim().toLowerCase();
  const mapped = Object.entries(workflow.statuses).find(([key]) => key.trim().toLowerCase() === name)?.[1];
  if (mapped) return mapped;
  if (BLOCKED.test(status)) return "Blocked";
  if (category === "new") return BACKLOG.test(status) ? "Backlog" : "To do";
  if (REVIEW.test(status)) return "In review";
  if (RELEASE.test(status)) return "Ready for release";
  return "In progress";
}
