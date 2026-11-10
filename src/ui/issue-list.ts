import { period } from "../dates";
import { View } from "../jira/query";
import { type Issue, issueProject, type TodaySection } from "../jira/types";
import type { Workspace } from "../state/workspace";
import type { Style } from "./canvas";
import { STAGES, stage, statusIcon } from "./status";

type Grouping = "status" | "assignee";
/** A heading's label, its issues, and the icon drawn before the label. */
type Group = [label: string, issues: Issue[], icon: string, iconStyle: Style];
type Heading = [label: string, icon: string, iconStyle: Style];

/** Icons for Team focus sections. */
const SECTION_ICONS: Record<TodaySection, [icon: string, style: Style]> = {
  Blocked: ["⊘", "error"],
  Stuck: ["◐", "warning"],
  "Needs an owner": ["○", "muted"],
  Overdue: ["!", "warning"],
  "Mentioned you": ["@", "accent"],
  "Your issues, changed since yesterday": ["◇", "accent"],
  "Assigned to you": ["◫", "accent"],
  "Waiting for release": ["◕", "ship"],
  "Forgotten in active sprints": ["◌", "muted"],
};

/** Issues matching the search, grouped under their headings in first-seen order. */
function group(issues: Issue[], search: string, heading: (issue: Issue) => Heading): Group[] {
  const needle = search.toLocaleLowerCase();
  const groups = new Map<string, Group>();
  for (const issue of issues) {
    const haystack = `${issue.key} ${issue.summary} ${issue.status} ${issueProject(issue)} ${issue.assignee}`;
    if (needle && !haystack.toLocaleLowerCase().includes(needle)) continue;
    const [label, icon, iconStyle] = heading(issue);
    const existing = groups.get(label);
    if (existing) existing[1].push(issue);
    else groups.set(label, [label, [issue], icon, iconStyle]);
  }
  return [...groups.values()];
}

const CATEGORY_RANK = { indeterminate: 0, new: 1, done: 2 } as const;

/** In progress first, then not started, then done; stable within each. */
const byCategory = (issues: Issue[]): Issue[] =>
  issues.toSorted((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);

function groupIssues(issues: Issue[], view: View, grouping: Grouping, search: string): Group[] {
  if (grouping === "assignee") {
    return group(byCategory(issues), search, (i) => [i.assignee, "◫", "accent"]).sort(([a], [b]) => a.localeCompare(b));
  }
  // Mentions arrive newest first; group by when you were mentioned.
  if (view === View.Mentions) return group(issues, search, (i) => [period(i.mention?.created ?? ""), "@", "accent"]);
  // Team focus arrives in section order, most urgent first.
  if (view === View.Today) {
    return group(issues, search, (i) => (i.section ? [i.section, ...SECTION_ICONS[i.section]] : ["", " ", "muted"]));
  }
  const rank = ([, [first]]: Group) => (first ? STAGES.indexOf(stage(first)) : 0);
  return group(issues, search, (i) => [stage(i), ...statusIcon(i)]).sort((a, b) => rank(a) - rank(b));
}

interface IssueRow {
  issue: Issue;
  group: string;
  row: number;
}

type ListRow = IssueRow | { label: string; count: number; icon: string; style: Style; folded: boolean };

interface Projection {
  source: Workspace["snapshot"];
  view: View;
  folded: ReadonlySet<string>;
  rows: ListRow[];
  issues: IssueRow[];
}

export class IssueList {
  private folded: ReadonlySet<string> = new Set();
  private projection: Projection | undefined;
  private cursor = 0;
  private offset = 0;
  private mode: Grouping = "status";
  private text = "";

  constructor(private readonly workspace: Workspace) {}

  get grouping(): Grouping {
    return this.mode;
  }

  get search(): string {
    return this.text;
  }

  filter(text: string): void {
    this.text = text;
    this.first();
  }

  private project(): Projection {
    const work = this.workspace;
    const source = work.current ? work.snapshot : null;
    const view = work.query.view;
    const { mode: grouping, text: search, folded } = this;
    const previous = this.projection;
    if (previous?.source === source && previous.view === view && previous.folded === folded) {
      return previous;
    }

    const selectedKey = previous?.issues[this.cursor]?.issue.key;
    const rows: ListRow[] = [];
    const issues: IssueRow[] = [];
    for (const [label, members, icon, style] of groupIssues(source?.issues ?? [], view, grouping, search)) {
      const closed = folded.has(label);
      rows.push({ label, count: members.length, icon, style, folded: closed });
      if (closed) continue;
      for (const issue of members) {
        const entry = { issue, group: label, row: rows.length };
        rows.push(entry);
        issues.push(entry);
      }
    }
    const index = issues.findIndex(({ issue }) => issue.key === selectedKey);
    this.cursor = index >= 0 ? index : Math.max(0, Math.min(this.cursor, issues.length - 1));
    this.projection = { source, view, folded, rows, issues };
    return this.projection;
  }

  get selected(): Issue | undefined {
    return this.project().issues[this.cursor]?.issue;
  }

  window(capacity: number) {
    const { rows, issues } = this.project();
    const selected = issues[this.cursor];
    const row = selected?.row ?? 0;
    if (row < this.offset) this.offset = Math.max(0, row - 1);
    if (row >= this.offset + capacity) this.offset = row - capacity + 1;
    this.offset = Math.max(0, Math.min(this.offset, rows.length - capacity));
    return { rows: rows.slice(this.offset, this.offset + capacity), count: issues.length, selected: selected?.issue };
  }

  move(delta: number): void {
    const { issues } = this.project();
    this.cursor = Math.max(0, Math.min(this.cursor + delta, issues.length - 1));
  }

  page(direction: -1 | 1, capacity: number): void {
    const { issues } = this.project();
    const current = issues[this.cursor];
    if (!current) return;
    const target = current.row + direction * Math.max(1, capacity - 1);
    const index =
      direction > 0
        ? Math.max(
            this.cursor + 1,
            issues.findLastIndex(({ row }) => row <= target),
          )
        : Math.min(
            this.cursor - 1,
            issues.findIndex(({ row }) => row >= target),
          );
    const next = issues[index];
    if (!next) return;
    this.cursor = index;
    this.offset += next.row - current.row;
  }

  click(key: string): Issue | undefined {
    const { issues } = this.project();
    const index = issues.findIndex(({ issue }) => issue.key === key);
    if (index < 0) return;
    if (index === this.cursor) return issues[index]?.issue;
    this.cursor = index;
  }

  toggle(label: string): void {
    const folded = new Set(this.folded);
    if (!folded.delete(label)) folded.add(label);
    this.folded = folded;
  }

  foldSelected(): void {
    const current = this.project().issues[this.cursor];
    if (current) this.toggle(current.group);
  }

  unfold(): void {
    if (this.folded.size) this.folded = new Set();
  }

  groupBy(grouping: Grouping): void {
    this.mode = grouping;
    this.unfold();
    this.first();
  }

  first(): void {
    this.projection = undefined;
    this.cursor = 0;
    this.offset = 0;
  }

  last(): void {
    this.cursor = Math.max(0, this.project().issues.length - 1);
  }
}
