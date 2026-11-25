/** Each view owns its server-side Jira scope. */
import { ALL_ASSIGNEES, type AssigneeFilter, sameAssignees } from "./assignee";

export const View = {
  Mine: 2,
  Created: 3,
  Today: 4,
  Mentions: 5,
  Search: 6,
  Team: 7,
} as const;
export type View = (typeof View)[keyof typeof View];

export const TEAM_MODES = ["all", "attention"] as const;
export type TeamMode = (typeof TEAM_MODES)[number];

export const PAGE = 200;
const UPDATED_ORDER = "ORDER BY updated DESC";
/** Jira Cloud requires a filter. Every issue has a status category. */
export const RECENT_ISSUES_JQL = `statusCategory IS NOT EMPTY ${UPDATED_ORDER}`;
/** Jira search cannot find @-mentions, so Mentions reads the comments of
 * issues updated within this many days. */
export const MENTION_DAYS = 14;

export const STATUSES = ["all", "open", "done"] as const;
export type StatusFilter = (typeof STATUSES)[number];

export interface IssueQuery {
  readonly view: View;
  readonly sprintFilter: number | null;
  readonly project: string;
  readonly assignee: AssigneeFilter;
  readonly status: StatusFilter;
  /** Search view: words to find across Jira, or an issue key. */
  readonly text: string;
  readonly limit: number;
}

export const initialQuery: IssueQuery = {
  view: View.Mentions,
  sprintFilter: null,
  project: "",
  assignee: ALL_ASSIGNEES,
  status: "all",
  text: "",
  limit: PAGE,
};

type ScopeChanges = Partial<Omit<IssueQuery, "limit">>;

/** A new scope starts again from the first page. */
export function scoped(query: IssueQuery, changes: ScopeChanges): IssueQuery {
  return { ...query, ...changes, limit: PAGE };
}

export function withView(query: IssueQuery, view: View): IssueQuery {
  return scoped(query, { view, assignee: view === View.Mine ? ALL_ASSIGNEES : query.assignee });
}

/** Assigned is always scoped to you; use Team issues to filter by assignee. */
export function withAssignee(query: IssueQuery, assignee: AssigneeFilter): IssueQuery {
  const view = assignee.people.length && query.view === View.Mine ? View.Team : query.view;
  return scoped(query, { view, assignee });
}

export const isReady = (query: IssueQuery): boolean => query.view !== View.Search || query.text !== "";

/** Same scope, ignoring how many pages are loaded. */
export function sameScope(a: IssueQuery, b: IssueQuery): boolean {
  return (
    a.view === b.view &&
    a.sprintFilter === b.sprintFilter &&
    a.project === b.project &&
    sameAssignees(a.assignee, b.assignee) &&
    a.status === b.status &&
    a.text === b.text
  );
}

export const sameQuery = (a: IssueQuery, b: IssueQuery): boolean => sameScope(a, b) && a.limit === b.limit;

/** This scope as JQL; `extra` terms narrow it further. */
export function jql(query: IssueQuery, ...extra: string[]): string {
  const terms = [...extra];
  if (query.sprintFilter !== null) terms.push(`sprint = ${query.sprintFilter}`);
  if (query.view === View.Mine) terms.push("assignee = currentUser()");
  if (query.view === View.Created) terms.push("creator = currentUser()");
  if (query.view === View.Mentions) terms.push(`updated >= -${MENTION_DAYS}d`);
  if (query.view === View.Search) terms.push(textTerm(query.text));
  if (query.project) terms.push(`project = ${JSON.stringify(query.project)}`);
  const assignee = assigneeTerm(query.assignee);
  if (assignee) terms.push(assignee);
  if (query.status === "open") terms.push("statusCategory != Done");
  if (query.status === "done") terms.push("statusCategory = Done");
  return terms.length ? `${terms.join(" AND ")} ${UPDATED_ORDER}` : RECENT_ISSUES_JQL;
}

function assigneeTerm({ mode, people }: AssigneeFilter): string {
  if (!people.length) return "";
  const ids = [...new Set(people.map((person) => person.id))];
  const unassigned = ids.includes("unassigned");
  const accounts = ids.filter((id) => id !== "unassigned");
  const empty = mode === "include" ? "assignee IS EMPTY" : "assignee IS NOT EMPTY";
  if (!accounts.length) return empty;
  const values = accounts.map((id) => JSON.stringify(id)).join(", ");
  const match =
    accounts.length === 1
      ? `assignee ${mode === "include" ? "=" : "!="} ${values}`
      : `assignee ${mode === "include" ? "IN" : "NOT IN"} (${values})`;
  if (mode === "include") return unassigned ? `(${match} OR ${empty})` : match;
  // Jira's negative comparisons omit empty fields unless explicitly included.
  return unassigned ? `(${match} AND ${empty})` : `(${match} OR assignee IS EMPTY)`;
}

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;
/** Characters Jira's text search treats as operators. */
const TEXT_OPERATORS = /[+\-&|!(){}[\]^~*?\\:"/]/g;

/** An issue key finds that issue; other words search summaries, descriptions and comments. */
function textTerm(text: string): string {
  const words = text.trim();
  if (ISSUE_KEY.test(words)) return `key = ${JSON.stringify(words.toUpperCase())}`;
  const plain = words.replace(TEXT_OPERATORS, " ").replace(/\s+/g, " ").trim();
  if (!plain) throw new Error("Type words to search for");
  return `text ~ ${JSON.stringify(plain)}`;
}
