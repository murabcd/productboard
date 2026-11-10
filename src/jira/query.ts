/** Each view owns its server-side Jira scope. */

export const View = {
  Sprint: 0,
  All: 1,
  Mine: 2,
  Created: 3,
  Today: 4,
  Mentions: 5,
  Search: 6,
} as const;
export type View = (typeof View)[keyof typeof View];

/** Views that always target the signed-in user. */
export const isPersonal = (view: View): boolean => view === View.Mine || view === View.Today;

export const PAGE = 200;
/** Jira search cannot find @-mentions, so Mentions reads the comments of
 * issues updated within this many days. */
export const MENTION_DAYS = 14;

export const STATUSES = ["all", "open", "done"] as const;
export type StatusFilter = (typeof STATUSES)[number];

export interface IssueQuery {
  readonly view: View;
  readonly sprint: number | null;
  readonly project: string;
  /** An account ID, "unassigned", or "" for everyone. */
  readonly assignee: string;
  readonly status: StatusFilter;
  /** Search view: words to find across Jira, or an issue key. */
  readonly text: string;
  readonly limit: number;
}

export const initialQuery: IssueQuery = {
  view: View.Sprint,
  sprint: null,
  project: "",
  assignee: "",
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
  return scoped(query, { view, assignee: isPersonal(view) ? "" : query.assignee });
}

/** Choosing a person from a personal view moves to everyone's tasks. */
export function withAssignee(query: IssueQuery, assignee: string): IssueQuery {
  const view = assignee && isPersonal(query.view) ? View.All : query.view;
  return scoped(query, { view, assignee });
}

export const isReady = (query: IssueQuery): boolean =>
  query.view === View.Sprint ? query.sprint !== null : query.view !== View.Search || query.text !== "";

/** Same scope, ignoring how many pages are loaded. */
export function sameScope(a: IssueQuery, b: IssueQuery): boolean {
  return (
    a.view === b.view &&
    a.sprint === b.sprint &&
    a.project === b.project &&
    a.assignee === b.assignee &&
    a.status === b.status &&
    a.text === b.text
  );
}

export const sameQuery = (a: IssueQuery, b: IssueQuery): boolean => sameScope(a, b) && a.limit === b.limit;

/** This scope as JQL; `extra` terms narrow it further. */
export function jql(query: IssueQuery, ...extra: string[]): string {
  const terms = [...extra];
  if (query.view === View.Sprint) {
    if (query.sprint === null) throw new Error("Choose a sprint first");
    terms.push(`sprint = ${query.sprint}`);
  }
  if (isPersonal(query.view)) terms.push("assignee = currentUser()");
  if (query.view === View.Created) terms.push("creator = currentUser()");
  if (query.view === View.Mentions) terms.push(`updated >= -${MENTION_DAYS}d`);
  if (query.view === View.Search) terms.push(textTerm(query.text));
  if (query.project) terms.push(`project = ${JSON.stringify(query.project)}`);
  if (query.assignee) {
    terms.push(query.assignee === "unassigned" ? "assignee IS EMPTY" : `assignee = ${JSON.stringify(query.assignee)}`);
  }
  if (query.status === "open") terms.push("statusCategory != Done");
  if (query.status === "done") terms.push("statusCategory = Done");
  // Jira Cloud rejects unbounded queries; every issue has a category.
  if (terms.length === 0) terms.push("statusCategory IS NOT EMPTY");
  return `${terms.join(" AND ")} ORDER BY updated DESC`;
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
