/** Locally saved Jira scopes. Pagination belongs to the workspace, never the saved view. */
import { z } from "zod";
import { ALL_ASSIGNEES, AssigneeFilter } from "../jira/assignee";
import { type IssueQuery, PAGE, STATUSES, sameScope, View } from "../jira/query";
import { clean } from "../text";

export const BREAKDOWNS = ["status", "assignee", "age"] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];
export const BREAKDOWN_NAMES: Record<Breakdown, string> = {
  status: "Status",
  assignee: "Assignee",
  age: "Open issue age",
};
export const VIEW_SCOPES = [View.Team, View.Mine, View.Created, View.Mentions] as const;
export const SavedScope = z.object({
  view: z.union(VIEW_SCOPES.map((view) => z.literal(view))),
  project: z.string(),
  sprintFilter: z.number().int().positive().nullable(),
  assignee: AssigneeFilter,
  status: z.enum(STATUSES),
});
const ViewRecord = z.object({
  id: z.string().min(1),
  name: z
    .string()
    .transform((name) => clean(name).trim())
    .pipe(z.string().min(1).max(45)),
  scope: SavedScope,
  board: z.string(),
  breakdown: z.enum(BREAKDOWNS),
});
/** Upgrade existing local single-person views at the preferences boundary. */
export const SavedView = z.union([
  ViewRecord,
  ViewRecord.extend({
    scope: SavedScope.extend({ assignee: z.string() }),
    personLabel: z.string().transform((label) => clean(label)),
  }).transform(({ personLabel, scope, ...view }) => ({
    ...view,
    scope: {
      ...scope,
      assignee: scope.assignee
        ? { mode: "include" as const, people: [{ id: scope.assignee, label: personLabel }] }
        : ALL_ASSIGNEES,
    },
  })),
]);
export type SavedView = z.infer<typeof SavedView>;
export type ViewDraft = Omit<SavedView, "id">;
export interface ViewPreferences {
  initial?: readonly SavedView[];
  save(views: readonly SavedView[]): void;
}

export function viewQuery(scope: SavedView["scope"]): IssueQuery {
  return { ...scope, text: "", limit: PAGE };
}

export function savedScope(query: IssueQuery): SavedView["scope"] {
  return SavedScope.parse(query);
}

export class SavedViews {
  private records: readonly SavedView[];
  active: { id: string; breakdown: Breakdown; bucket: string | null; cursor: number } | undefined;

  constructor(private readonly preferences?: ViewPreferences) {
    this.records = preferences?.initial ?? [];
  }

  get all(): readonly SavedView[] {
    return this.records;
  }

  get current(): SavedView | undefined {
    return this.records.find((view) => view.id === this.active?.id);
  }

  open(id: string): SavedView | undefined {
    const view = this.records.find((record) => record.id === id);
    if (view) this.active = { id, breakdown: view.breakdown, bucket: null, cursor: 0 };
    return view;
  }

  save(draft: ViewDraft, id: string = crypto.randomUUID()): SavedView {
    const view = SavedView.parse({ ...draft, id });
    const records = this.records.some((record) => record.id === id)
      ? this.records.map((record) => (record.id === id ? view : record))
      : [...this.records, view];
    this.preferences?.save(records);
    this.records = records;
    return view;
  }

  remove(id: string): void {
    const records = this.records.filter((view) => view.id !== id);
    this.preferences?.save(records);
    this.records = records;
    if (this.active?.id === id) this.active = undefined;
  }

  modified(query: IssueQuery, board: string): boolean {
    const view = this.current;
    if (!view || !this.active) return false;
    return view.board !== board || view.breakdown !== this.active.breakdown || !sameScope(viewQuery(view.scope), query);
  }
}
