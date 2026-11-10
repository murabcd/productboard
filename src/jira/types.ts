/** Domain types the dashboard works with, decoded from Jira responses. */

import { shortDate, usDate, when } from "../dates";
import type { DocBlock } from "./adf";

export type Category = "new" | "indeterminate" | "done";

/** Status names teams use for stages Jira's three categories don't have. */
export const BLOCKED_STATUS = /blocked/i;
export const BACKLOG_STATUS = /backlog/i;
/** Icebox counts as done in Jira, but the work was parked, not finished. */
export const ICEBOX_STATUS = /icebox/i;
export const REVIEW_STATUS = /review|\bqa\b/i;
export const READY_FOR_RELEASE_STATUS = /ready for release/i;

/** Today's sections in display order; an issue appears only in the first that fits. */
export const TODAY_SECTIONS = [
  "Blocked",
  "Stuck",
  "Needs an owner",
  "Overdue",
  "Mentioned you",
  "Your issues, changed since yesterday",
  "Assigned to you",
  "Waiting for release",
  "Forgotten in active sprints",
] as const;
export type TodaySection = (typeof TODAY_SECTIONS)[number];

export interface Issue {
  key: string;
  summary: string;
  status: string;
  category: Category;
  priority: string;
  assigneeId: string;
  assignee: string;
  /** The sprint the issue is in now, or "" when it is in none. */
  sprint: string;
  /** The newest comment that @-mentions you, when the view looked for one. */
  mention?: Comment;
  /** Today: the section this issue belongs to, and why, e.g. "blocked by FL-12". */
  section?: TodaySection;
  reason?: string;
}

export function issueProject(issue: Issue): string {
  return issue.key.slice(0, issue.key.lastIndexOf("-"));
}

/** Who mentioned you and when, e.g. "Jordan Ellis · Oct 30". */
export const mentionNote = (mention: Comment, now = Date.now()): string =>
  `${mention.author} · ${when(mention.created, now)}`;

export interface Comment {
  author: string;
  /** "2026-11-05 13:08", in Jira's timezone. */
  created: string;
  /** Plain text, for one-line previews. */
  text: string;
  doc: DocBlock[];
  mentionsMe: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  author: string;
  created: string;
}

export interface Detail {
  facts: string[];
  description: DocBlock[];
  /** Newest first. */
  comments: Comment[];
  attachments: Attachment[];
}

/** One row in a picker. `state` lets pickers with tabs filter choices. */
export interface Choice {
  value: string;
  label: string;
  detail: string;
  state: string;
}

export const SPRINT_STATES = ["active", "future", "closed"] as const;
export type SprintState = (typeof SPRINT_STATES)[number];

export interface Sprint {
  id: number;
  name: string;
  state: SprintState;
  start: string;
  end: string;
  goal: string;
}

/** A sprint's name without its board's prefix: "Platform Team - Sprint 2" reads "Sprint 2". */
const SPRINT_PREFIX_END = /\s[-–—|]\s/;
export const shortSprintName = (name: string): string => name.split(SPRINT_PREFIX_END).at(-1) ?? name;

export const SPRINT_STATE_NAMES: Record<SprintState, string> = {
  active: "Active",
  future: "Upcoming",
  closed: "Closed",
};

/** "Nov 2–13" within a month, else "Oct 28–Nov 6", with the year once when it
 * isn't this one: "Oct 20–Nov 3, 2025"; "" without dates. */
export function sprintDates(sprint: Sprint): string {
  if (!sprint.start || !sprint.end) return "";
  const [start = "", startYear] = shortDate(sprint.start).split(", ");
  const [end = "", endYear] = shortDate(sprint.end).split(", ");
  if (startYear !== endYear) return `${shortDate(sprint.start)}–${shortDate(sprint.end)}`;
  const [startMonth] = start.split(" ");
  const [endMonth, endDay] = end.split(" ");
  const range = `${start}–${startMonth === endMonth ? endDay : end}`;
  return endYear ? `${range}, ${endYear}` : range;
}

export function sprintChoice(sprint: Sprint): Choice {
  return {
    value: String(sprint.id),
    label: sprint.name,
    detail: [SPRINT_STATE_NAMES[sprint.state], sprintDates(sprint) || "No dates"].join(" · "),
    state: sprint.state,
  };
}

/** Image types the terminal preview can draw. */
const PREVIEWABLE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;
export const isImage = (item: Attachment): boolean => PREVIEWABLE_IMAGE.test(item.mimeType);

export function humanSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

export function describeAttachment(item: Attachment): string {
  return `${humanSize(item.size)} · ${item.author} · ${usDate(item.created)}`;
}
