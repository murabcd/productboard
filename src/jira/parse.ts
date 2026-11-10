/** Validate Jira REST responses and decode them into domain types. */

import { z } from "zod";
import { clean } from "../text";
import { mentions, plainText, toDoc } from "./adf";
import type { Attachment, Choice, Comment, Detail, Issue, Sprint } from "./types";
import { SPRINT_STATES } from "./types";

export class PayloadError extends Error {}

/** Parse at the boundary; a mismatch is reported, never shown as "no work". */
export function decode<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new PayloadError(`Jira returned an unexpected ${what}`);
  return result.data;
}

const Person = z.object({ displayName: z.string() }).partial().nullish();

const RawComment = z.object({
  author: Person,
  created: z.string().optional(),
  body: z.unknown(),
});

export const CommentPage = z.object({
  comments: z.array(RawComment),
  startAt: z.number().optional(),
  total: z.number().optional(),
});
export type CommentPage = z.infer<typeof CommentPage>;

/** Fields every issue list reads. */
export const LIST_FIELDS = ["summary", "status", "priority", "assignee"];

const BlockLink = z.object({
  type: z.object({ name: z.string() }),
  inwardIssue: z
    .object({
      key: z.string(),
      fields: z.object({ status: z.object({ statusCategory: z.object({ key: z.string() }) }) }),
    })
    .optional(),
});

/** One sprint as Jira returns it inside an issue's sprint field. */
const SprintRef = z.object({ name: z.string(), state: z.string().optional() });
const SprintRefs = z.array(SprintRef);

/** Jira's field catalog; the sprint field's ID differs between sites. */
export const RawFields = z.array(
  z.object({ id: z.string(), schema: z.object({ custom: z.string().optional() }).optional() }),
);
const SPRINT_FIELD_TYPE = "com.pyxis.greenhopper.jira:gh-sprint";

/** The ID of the sprint field, e.g. "customfield_10020", when the site has one. */
export const sprintFieldId = (fields: z.infer<typeof RawFields>): string | undefined =>
  fields.find((field) => field.schema?.custom === SPRINT_FIELD_TYPE)?.id;

export const RawIssue = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string(),
    status: z.object({
      name: z.string(),
      statusCategory: z.object({ key: z.enum(["new", "indeterminate", "done"]) }),
    }),
    priority: z.object({ name: z.string() }).nullish(),
    assignee: z.object({ accountId: z.string(), displayName: z.string() }).nullish(),
    comment: CommentPage.optional(),
    updated: z.string().optional(),
    duedate: z.string().nullish(),
    issuelinks: z.array(BlockLink).optional(),
    /** Filled from the site's sprint field by `withSprints`. */
    sprints: SprintRefs.optional(),
  }),
});
export type RawIssue = z.infer<typeof RawIssue>;

/** An issue with the site's sprint field moved to `sprints`. The field is
 * validated here; a value Jira shapes differently means no sprint, not an error. */
export function withSprints(raw: RawIssue, value: unknown): RawIssue {
  const sprints = SprintRefs.safeParse(value);
  return sprints.success ? { ...raw, fields: { ...raw.fields, sprints: sprints.data } } : raw;
}

/** The sprint an issue is in now: the active one, else the next planned one,
 * else the last it was in. */
function currentSprint(sprints: z.infer<typeof SprintRefs> | undefined): string {
  if (!sprints?.length) return "";
  const sprint =
    sprints.find((s) => s.state === "active") ?? sprints.find((s) => s.state === "future") ?? sprints.at(-1);
  return clean(sprint?.name ?? "");
}

/** The first still-open issue that blocks this one, if any. */
export function openBlocker(raw: RawIssue): string | undefined {
  const link = raw.fields.issuelinks?.find(
    (l) => l.type.name === "Blocks" && l.inwardIssue && l.inwardIssue.fields.status.statusCategory.key !== "done",
  );
  return link?.inwardIssue ? clean(link.inwardIssue.key) : undefined;
}

/** A Jira timestamp ("2026-11-05T13:08:14.000+0300") in milliseconds. */
export function jiraTime(value: string): number {
  return Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

/** Search results keep fields the schema doesn't name, such as the site's
 * sprint field, until `withSprints` reads them. */
const SearchIssue = RawIssue.extend({ fields: RawIssue.shape.fields.catchall(z.unknown()) });

export const SearchPage = z.object({
  issues: z.array(SearchIssue),
  nextPageToken: z.string().nullish(),
  isLast: z.boolean().optional(),
});

export const Myself = z.object({ accountId: z.string(), displayName: z.string() });
export type Myself = z.infer<typeof Myself>;

/** Agile and project-search endpoints page with startAt and isLast. */
export const pageOf = <T>(item: z.ZodType<T>) =>
  z.object({ values: z.array(item), isLast: z.boolean().optional(), total: z.number().optional() });

export const RawBoard = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string().optional(),
  location: z.object({ displayName: z.string().optional() }).partial().optional(),
});

export const RawProject = z.object({ key: z.string(), name: z.string() });

export const RawSprint = z.object({
  id: z.number(),
  name: z.string(),
  state: z.enum(SPRINT_STATES),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  goal: z.string().nullish(),
});

export const RawDetail = z.object({
  fields: z
    .object({
      description: z.unknown(),
      project: z.object({ name: z.string() }).nullish(),
      assignee: z.object({ displayName: z.string() }).nullish(),
      priority: z.object({ name: z.string() }).nullish(),
      comment: CommentPage.optional(),
      attachment: z.array(z.unknown()).optional(),
    })
    .partial(),
});
export type RawDetail = z.infer<typeof RawDetail>;

const RawAttachment = z.object({
  id: z.union([z.string(), z.number()]),
  filename: z.string(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
  author: Person,
  created: z.string().optional(),
});

/** Jira timestamps as "2026-11-05 13:08", in Jira's timezone. */
export function stamp(value: string | undefined): string {
  return value ? clean(value.slice(0, 16).replace("T", " ")) : "";
}

const personName = (person: z.infer<typeof Person>): string =>
  person?.displayName ? clean(person.displayName) : "Unknown";

export function toIssue(raw: RawIssue): Issue {
  const { fields } = raw;
  return {
    key: clean(raw.key),
    summary: clean(fields.summary),
    status: clean(fields.status.name),
    category: fields.status.statusCategory.key,
    priority: clean(fields.priority?.name ?? ""),
    assigneeId: fields.assignee?.accountId ?? "",
    assignee: fields.assignee ? clean(fields.assignee.displayName) : "Unassigned",
    sprint: currentSprint(fields.sprints),
  };
}

/** Whether a comment page holds every comment on the issue. */
export function isComplete(page: CommentPage | undefined): page is CommentPage {
  return page !== undefined && (page.total ?? 0) <= page.comments.length;
}

/** Comments oldest first, flagging the ones that @-mention `me`. */
export function toComments(rows: CommentPage["comments"], me: string): Comment[] {
  return rows.map((row) => {
    const doc = toDoc(row.body);
    return {
      author: personName(row.author),
      created: stamp(row.created),
      text: plainText(doc),
      doc,
      mentionsMe: mentions(row.body, me),
    };
  });
}

export function latestMention(comments: Comment[]): Comment | undefined {
  return comments.findLast((comment) => comment.mentionsMe);
}

export function toAttachments(rows: unknown[]): Attachment[] {
  return rows.flatMap((row) => {
    const result = RawAttachment.safeParse(row);
    if (!result.success) return [];
    const item = result.data;
    return [
      {
        id: String(item.id),
        filename: clean(item.filename),
        mimeType: clean(item.mimeType ?? ""),
        size: item.size ?? 0,
        author: personName(item.author),
        created: stamp(item.created),
      },
    ];
  });
}

/** Issue details; `comments` is the full thread, oldest first. */
export function toDetail(raw: RawDetail, comments: Comment[]): Detail {
  const { fields } = raw;
  const facts = [
    ["Project", fields.project?.name],
    ["Assignee", fields.assignee?.displayName],
    ["Priority", fields.priority?.name],
  ].flatMap(([label, value]) => (value ? [`${label}: ${clean(value)}`] : []));
  return {
    facts,
    description: toDoc(fields.description),
    comments: [...comments].reverse(),
    attachments: toAttachments(fields.attachment ?? []),
  };
}

export function toBoardChoice(board: z.infer<typeof RawBoard>): Choice {
  return {
    value: String(board.id),
    label: clean(board.name),
    detail: clean(board.location?.displayName ?? board.type ?? ""),
    state: "",
  };
}

export function toProjectChoice(project: z.infer<typeof RawProject>): Choice {
  return { value: project.key, label: clean(project.name), detail: clean(project.key), state: "" };
}

export function toSprint(sprint: z.infer<typeof RawSprint>): Sprint {
  return {
    id: sprint.id,
    name: clean(sprint.name),
    state: sprint.state,
    start: clean(sprint.startDate ?? ""),
    end: clean(sprint.endDate ?? ""),
    goal: clean(sprint.goal ?? "", true),
  };
}

/** Active first, then planned, then closed; newest first within each. */
export function sortSprints(sprints: Sprint[]): Sprint[] {
  return [...sprints].sort((a, b) => SPRINT_STATES.indexOf(a.state) - SPRINT_STATES.indexOf(b.state) || b.id - a.id);
}
