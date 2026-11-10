/** Today: what needs a product manager's attention, most urgent first. */

import { localDay, usDate } from "../dates";
import type { JiraClient } from "./client";
import { jiraTime, LIST_FIELDS, openBlocker, type RawIssue, toIssue } from "./parse";
import { type IssueQuery, initialQuery, jql, View } from "./query";
import {
  BACKLOG_STATUS,
  BLOCKED_STATUS,
  type Issue,
  mentionNote,
  READY_FOR_RELEASE_STATUS,
  TODAY_SECTIONS,
  type TodaySection,
} from "./types";

/** Its heading already names the person, so rows there leave the assignee out. */
export const YOURS: TodaySection = "Assigned to you";

/** In progress with no update for this many days counts as stuck. */
export const STUCK_DAYS = 5;
/** Untouched this long, sprint work is forgotten (often a sprint never closed). */
export const FORGOTTEN_DAYS = 30;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const TIMED_FIELDS = [...LIST_FIELDS, "updated"];
const SPRINT_FIELDS = [...TIMED_FIELDS, "duedate", "issuelinks"];

type Source = Pick<JiraClient, "search" | "mentions">;

/** How long ago a moment was, e.g. "45m ago", "3h ago", "6d ago". */
export function ago(ms: number, now: number): string {
  const span = Math.max(0, now - ms);
  if (span < HOUR_MS) return `${Math.max(1, Math.floor(span / 60_000))}m ago`;
  if (span < DAY_MS) return `${Math.floor(span / HOUR_MS)}h ago`;
  return `${Math.floor(span / DAY_MS)}d ago`;
}

/** Why an active-sprint issue needs attention, or undefined when it doesn't.
 * Blocked names its cause when Jira knows one; a "Blocked" status alone
 * leaves the reason empty because the status column already says it. */
function attention(issue: Issue, raw: RawIssue, flagged: Set<string>, now: number): [TodaySection, string] | undefined {
  const idle = raw.fields.updated ? Math.floor((now - jiraTime(raw.fields.updated)) / DAY_MS) : 0;
  // Long-untouched work would bury live problems, so it is set aside first.
  if (idle >= FORGOTTEN_DAYS) return ["Forgotten in active sprints", `${idle}d no update`];
  if (flagged.has(issue.key)) return ["Blocked", "Flagged"];
  const blocker = openBlocker(raw);
  if (blocker) return ["Blocked", `blocked by ${blocker}`];
  if (BLOCKED_STATUS.test(issue.status)) return ["Blocked", ""];
  if (READY_FOR_RELEASE_STATUS.test(issue.status)) {
    return idle >= STUCK_DAYS ? ["Waiting for release", `${idle}d waiting`] : undefined;
  }
  if (issue.category === "indeterminate" && idle >= STUCK_DAYS) return ["Stuck", `${idle}d no update`];
  if (!issue.assigneeId) return ["Needs an owner", "No assignee"];
  const due = raw.fields.duedate;
  if (due && due < localDay(now)) return ["Overdue", `due ${usDate(due)}`];
  return undefined;
}

export async function today(
  source: Source,
  query: IssueQuery,
  now = Date.now(),
): Promise<{ issues: Issue[]; more: boolean }> {
  // The project filter narrows every section, e.g. to one team's project.
  const scope = { ...initialQuery, view: View.All, project: query.project };
  const where = (...terms: string[]) => jql(scope, ...terms);
  const inSprint = ["sprint in openSprints()", "statusCategory != Done"];
  const [sprintWork, flagged, mentioned, created, assigned] = await Promise.all([
    source.search(where(...inSprint), SPRINT_FIELDS, query.limit + 1),
    source.search(where(...inSprint, "flagged = Impediment"), LIST_FIELDS, query.limit),
    source.mentions(where("updated >= startOfDay(-1)"), query.limit),
    source.search(
      where("(creator = currentUser() OR reporter = currentUser())", "updated >= startOfDay(-1)"),
      TIMED_FIELDS,
      query.limit,
    ),
    source.search(where("assignee = currentUser()", "statusCategory != Done"), TIMED_FIELDS, query.limit),
  ]);

  const sections = new Map<TodaySection, Issue[]>(TODAY_SECTIONS.map((name) => [name, []]));
  const placed = new Set<string>();
  const place = (section: TodaySection, issue: Issue, reason: string) => {
    if (placed.has(issue.key)) return;
    placed.add(issue.key);
    sections.get(section)?.push({ ...issue, section, ...(reason && { reason }) });
  };

  const flaggedKeys = new Set(flagged.map((raw) => raw.key));
  const updated = new Map<string, string>();
  for (const raw of sprintWork.slice(0, query.limit)) {
    const issue = toIssue(raw);
    const found = attention(issue, raw, flaggedKeys, now);
    if (found) place(found[0], issue, found[1]);
    updated.set(raw.key, raw.fields.updated ?? "");
  }
  // Idle work reads oldest first; every other section keeps the newest first.
  const age = (issue: Issue) => jiraTime(updated.get(issue.key) || "1970-01-01T00:00:00.000+0000");
  for (const name of ["Stuck", "Waiting for release", "Forgotten in active sprints"] as const)
    sections.get(name)?.sort((a, b) => age(a) - age(b));

  const yesterday = localDay(now - DAY_MS);
  for (const issue of mentioned.issues) {
    if (issue.mention && issue.mention.created >= yesterday)
      place("Mentioned you", issue, mentionNote(issue.mention, now));
  }
  // The status column shows the new state; the reason says when it changed.
  const updatedAgo = (raw: RawIssue) => (raw.fields.updated ? `updated ${ago(jiraTime(raw.fields.updated), now)}` : "");
  for (const raw of created) place("Your issues, changed since yesterday", toIssue(raw), updatedAgo(raw));
  // Work under way first, then planned work, then the backlog.
  const rank = ({ fields }: RawIssue) =>
    fields.status.statusCategory.key === "indeterminate" ? 0 : BACKLOG_STATUS.test(fields.status.name) ? 2 : 1;
  for (const raw of assigned.toSorted((a, b) => rank(a) - rank(b))) place(YOURS, toIssue(raw), updatedAgo(raw));

  return {
    issues: TODAY_SECTIONS.flatMap((name) => sections.get(name) ?? []),
    more: sprintWork.length > query.limit,
  };
}
