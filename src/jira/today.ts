/** Today: what needs a product manager's attention, most urgent first. */

import { localDay, usDate } from "../dates";
import { readAttention } from "./attention-reads";
import { jiraTime, openBlocker, type RawIssue, toIssue } from "./parse";
import type { IssueQuery } from "./query";
import { type Issue, mentionNote, TODAY_SECTIONS, type TodaySection } from "./types";
import { DEFAULT_WORKFLOW, type Workflow } from "./workflow";

/** Its heading already names the person, so rows there leave the assignee out. */
export const YOURS: TodaySection = "Assigned to you";

/** In progress with no update for this many days counts as stuck. */
export const STUCK_DAYS = 5;
/** Long-idle work is set aside so it doesn't bury current problems. */
export const FORGOTTEN_DAYS = 30;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** How long ago a moment was, e.g. "45m ago", "3h ago", "6d ago". */
export function ago(ms: number, now: number): string {
  const span = Math.max(0, now - ms);
  if (span < HOUR_MS) return `${Math.max(1, Math.floor(span / 60_000))}m ago`;
  if (span < DAY_MS) return `${Math.floor(span / HOUR_MS)}h ago`;
  return `${Math.floor(span / DAY_MS)}d ago`;
}

/** Why an open issue needs attention, or undefined when it doesn't.
 * Blocked names its cause when Jira knows one; a "Blocked" status alone
 * leaves the reason empty because the status column already says it. */
function attention(
  issue: Issue,
  raw: RawIssue,
  flagged: Set<string>,
  now: number,
  workflow: Workflow,
): [TodaySection, string] | undefined {
  const idle = raw.fields.updated ? Math.floor((now - jiraTime(raw.fields.updated)) / DAY_MS) : 0;
  // Long-untouched work would bury live problems, so it is set aside first.
  if (
    idle >= FORGOTTEN_DAYS &&
    (issue.category === "indeterminate" || raw.fields.sprints?.some((sprint) => sprint.state === "active"))
  )
    return ["Long untouched", `${idle}d no update`];
  if (flagged.has(issue.key)) return ["Blocked", "Flagged"];
  const blocker = openBlocker(raw, workflow);
  if (blocker) return ["Blocked", `blocked by ${blocker}`];
  if (issue.stage === "Blocked") return ["Blocked", ""];
  if (issue.stage === "Ready for release") {
    return idle >= STUCK_DAYS ? ["Waiting for release", `${idle}d waiting`] : undefined;
  }
  if (issue.category === "indeterminate" && idle >= STUCK_DAYS) return ["Stuck", `${idle}d no update`];
  if (!issue.assigneeId) return ["Needs an owner", "No assignee"];
  const due = raw.fields.duedate;
  if (due && due < localDay(now)) return ["Overdue", `due ${usDate(due)}`];
  return undefined;
}

export async function today(
  source: Parameters<typeof readAttention>[0],
  query: IssueQuery,
  {
    now = Date.now(),
    signal,
    workflow = DEFAULT_WORKFLOW,
  }: { now?: number; signal?: AbortSignal; workflow?: Workflow } = {},
): Promise<{ issues: Issue[]; more: boolean; warnings: string[] }> {
  const { work, flagged, mentioned, created, assigned, warnings } = await readAttention(source, query, signal);

  const sections = new Map<TodaySection, Issue[]>(TODAY_SECTIONS.map((name) => [name, []]));
  const placed = new Set<string>();
  const place = (section: TodaySection, issue: Issue, reason: string) => {
    if (placed.has(issue.key)) return;
    placed.add(issue.key);
    sections.get(section)?.push({ ...issue, section, ...(reason && { reason }) });
  };

  const flaggedKeys = new Set(flagged.map((raw) => raw.key));
  const updated = new Map<string, string>();
  const attentionWork = new Map(
    [...work.slice(0, query.limit), ...flagged.slice(0, query.limit)].map((raw) => [raw.key, raw]),
  );
  for (const raw of attentionWork.values()) {
    const issue = toIssue(raw, workflow);
    const found = attention(issue, raw, flaggedKeys, now, workflow);
    if (found) place(found[0], issue, found[1]);
    updated.set(raw.key, raw.fields.updated ?? "");
  }
  // Idle work reads oldest first; every other section keeps the newest first.
  const age = (issue: Issue) => jiraTime(updated.get(issue.key) || "1970-01-01T00:00:00.000+0000");
  for (const name of ["Stuck", "Waiting for release", "Long untouched"] as const)
    sections.get(name)?.sort((a, b) => age(a) - age(b));

  const yesterday = localDay(now - DAY_MS);
  for (const issue of mentioned.issues) {
    if (issue.mention && issue.mention.created >= yesterday)
      place("Mentioned you", issue, mentionNote(issue.mention, now));
  }
  // The status column shows the new state; the reason says when it changed.
  const updatedAgo = (raw: RawIssue) => (raw.fields.updated ? `updated ${ago(jiraTime(raw.fields.updated), now)}` : "");
  for (const raw of created.slice(0, query.limit))
    place("Your issues, changed since yesterday", toIssue(raw, workflow), updatedAgo(raw));
  // Work under way first, then planned work, then the backlog.
  const rank = (issue: Issue) => (issue.category === "indeterminate" ? 0 : issue.stage === "Backlog" ? 2 : 1);
  const assignedIssues = assigned.slice(0, query.limit).map((raw) => ({ issue: toIssue(raw, workflow), raw }));
  for (const { issue, raw } of assignedIssues.toSorted((a, b) => rank(a.issue) - rank(b.issue)))
    place(YOURS, issue, updatedAgo(raw));

  return {
    issues: TODAY_SECTIONS.flatMap((name) => sections.get(name) ?? []),
    more: [work, flagged, created, assigned].some((rows) => rows.length > query.limit) || mentioned.more,
    warnings,
  };
}
