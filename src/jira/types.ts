/** Domain types the dashboard works with, decoded from Jira responses. */

import type { DocBlock } from "./adf";

export type Category = "new" | "indeterminate" | "done";

export interface Issue {
  key: string;
  summary: string;
  status: string;
  category: Category;
  priority: string;
  assigneeId: string;
  assignee: string;
  /** The newest comment that @-mentions you, when the view looked for one. */
  mention?: Comment;
  /** Today: the section this issue belongs to, and why, e.g. "QA Blocked". */
  section?: string;
  reason?: string;
}

export function issueProject(issue: Issue): string {
  return issue.key.slice(0, issue.key.lastIndexOf("-"));
}

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

export function sprintChoice(sprint: Sprint): Choice {
  const dates = sprint.start ? `${sprint.start.slice(0, 10)} → ${sprint.end.slice(0, 10)}` : "No dates";
  return {
    value: String(sprint.id),
    label: sprint.name,
    detail: `${sprint.state} · ${dates}`,
    state: sprint.state,
  };
}

/** Image types the terminal preview can draw. */
export const isImage = (item: Attachment): boolean => /^image\/(png|jpeg|gif|webp)$/.test(item.mimeType);

export function humanSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

export function describeAttachment(item: Attachment): string {
  return `${humanSize(item.size)} · ${item.author} · ${item.created.slice(0, 10)}`;
}
