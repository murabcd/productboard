/** Every Jira read the dashboard makes. The client never writes Jira data. */

import type { z } from "zod";
import { JiraError, type JiraHttp } from "./http";
import {
  CommentPage,
  isComplete,
  LIST_FIELDS,
  latestMention,
  Myself,
  pageOf,
  RawBoard,
  RawDetail,
  RawFields,
  type RawIssue,
  RawProject,
  RawSprint,
  SearchPage,
  sortSprints,
  sprintFieldId,
  toBoardChoice,
  toComments,
  toDetail,
  toIssue,
  toProjectChoice,
  toSprint,
  withSprints,
} from "./parse";
import { type IssueQuery, jql, View } from "./query";
import { today } from "./today";
import type { Choice, Detail, Issue, Sprint } from "./types";

export interface Snapshot {
  issues: Issue[];
  query: IssueQuery;
  more: boolean;
  /** Mentions view: how many recently updated issues were read. */
  scanned: number;
}

export interface Catalog {
  boards: Choice[];
  projects: Choice[];
}

const DETAIL_FIELDS = "description,project,assignee,priority,comment,attachment";
/** Jira's largest search page. */
const SEARCH_PAGE = 100;

export class JiraClient {
  private me: Promise<Myself> | undefined;
  private sprintField: Promise<string | undefined> | undefined;

  constructor(private readonly http: JiraHttp) {}

  get site(): string {
    return this.http.credentials.site;
  }

  /** The signed-in account, read once per session. */
  myself(): Promise<Myself> {
    this.me ??= this.http.get("/rest/api/3/myself", {}, Myself, "account").catch((error: unknown) => {
      this.me = undefined;
      throw error;
    });
    return this.me;
  }

  /** The site's sprint field, looked up once per session. Lists still load
   * without sprints when the lookup fails; the next search tries again. */
  private sprintFieldId(): Promise<string | undefined> {
    this.sprintField ??= this.http.get("/rest/api/3/field", {}, RawFields, "field list").then(sprintFieldId, () => {
      this.sprintField = undefined;
      return undefined;
    });
    return this.sprintField;
  }

  /** Up to `limit` issues for JQL, following Jira's page tokens. Each issue
   * also carries its sprints. */
  async search(query: string, fields: string[], limit: number): Promise<RawIssue[]> {
    const sprintField = await this.sprintFieldId();
    const issues: RawIssue[] = [];
    const seen = new Set<string>();
    let token: string | undefined;
    while (issues.length < limit) {
      const page = await this.http.post(
        "/rest/api/3/search/jql",
        {
          jql: query,
          fields: sprintField ? [...fields, sprintField] : fields,
          maxResults: Math.min(SEARCH_PAGE, limit - issues.length),
          ...(token ? { nextPageToken: token } : {}),
        },
        SearchPage,
        "issue list",
      );
      issues.push(...page.issues.map((raw) => (sprintField ? withSprints(raw, raw.fields[sprintField]) : raw)));
      const next = page.nextPageToken ?? undefined;
      if (!next || page.isLast || page.issues.length === 0 || seen.has(next)) break;
      seen.add(next);
      token = next;
    }
    return issues.slice(0, limit);
  }

  async snapshot(query: IssueQuery): Promise<Snapshot> {
    if (query.view === View.Mentions) return { query, ...(await this.mentions(jql(query), query.limit)) };
    if (query.view === View.Today) return { query, scanned: 0, ...(await today(this, query)) };
    const found = await this.search(jql(query), LIST_FIELDS, query.limit + 1);
    return { issues: found.slice(0, query.limit).map(toIssue), query, more: found.length > query.limit, scanned: 0 };
  }

  /** Issues matching the JQL whose comments @-mention you, newest mention first. */
  async mentions(query: string, limit: number): Promise<{ issues: Issue[]; more: boolean; scanned: number }> {
    const found = await this.search(query, [...LIST_FIELDS, "comment"], limit + 1);
    const rows = found.slice(0, limit);
    return { issues: await this.mentioned(rows), more: found.length > limit, scanned: rows.length };
  }

  /** The issues whose comments @-mention you, newest mention first. */
  private async mentioned(rows: RawIssue[]): Promise<Issue[]> {
    const { accountId } = await this.myself();
    const found = await Promise.all(
      rows.map(async (row): Promise<Issue[]> => {
        const page = row.fields.comment;
        const thread = isComplete(page) ? page.comments : await this.allComments(row.key);
        const mention = latestMention(toComments(thread, accountId));
        return mention ? [{ ...toIssue(row), mention }] : [];
      }),
    );
    return found.flat().sort((a, b) => (b.mention?.created ?? "").localeCompare(a.mention?.created ?? ""));
  }

  /** Every comment on an issue, oldest first. */
  async allComments(key: string): Promise<CommentPage["comments"]> {
    const comments: CommentPage["comments"] = [];
    for (;;) {
      const page = await this.http.get(
        `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
        { startAt: comments.length, maxResults: 100 },
        CommentPage,
        "comment list",
      );
      comments.push(...page.comments);
      if (page.comments.length === 0 || comments.length >= (page.total ?? 0)) return comments;
    }
  }

  async catalog(): Promise<Catalog> {
    const [boards, projects] = await Promise.all([
      this.pages("/rest/agile/1.0/board", RawBoard, "board list"),
      this.pages("/rest/api/3/project/search", RawProject, "project list"),
    ]);
    const byLabel = (a: Choice, b: Choice) => a.label.localeCompare(b.label);
    return {
      boards: boards.map(toBoardChoice).sort(byLabel),
      projects: projects.map(toProjectChoice).sort(byLabel),
    };
  }

  async sprints(board: string): Promise<Sprint[]> {
    try {
      const sprints = await this.pages(
        `/rest/agile/1.0/board/${encodeURIComponent(board)}/sprint`,
        RawSprint,
        "sprint list",
      );
      return sortSprints(sprints.map(toSprint));
    } catch (error) {
      if (error instanceof JiraError && error.status === 400) {
        throw new JiraError("This board doesn't use sprints. Press b to choose another board.");
      }
      throw error;
    }
  }

  async detail(key: string): Promise<Detail> {
    const [raw, me] = await Promise.all([
      this.http.get(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: DETAIL_FIELDS }, RawDetail, "issue"),
      // Without the account, details still load; mentions just aren't flagged.
      this.myself().then(
        (account) => account.accountId,
        () => "",
      ),
    ]);
    const page = raw.fields.comment;
    const thread = isComplete(page) ? page.comments : await this.allComments(key);
    return toDetail(raw, toComments(thread, me));
  }

  attachment(id: string): Promise<Uint8Array> {
    return this.http.download(`/rest/api/3/attachment/content/${encodeURIComponent(id)}`);
  }

  /** Every item of a startAt/isLast paginated list. These are the board,
   * project and sprint catalogs, which load behind the issue list. */
  private async pages<T>(path: string, item: z.ZodType<T>, what: string): Promise<T[]> {
    const items: T[] = [];
    for (;;) {
      const page = await this.http.get(
        path,
        { startAt: items.length, maxResults: 50 },
        pageOf(item),
        what,
        "background",
      );
      items.push(...page.values);
      const done = page.isLast ?? (page.total === undefined || items.length >= page.total);
      if (done || page.values.length === 0) return items;
    }
  }
}
