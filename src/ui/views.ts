/** Saved-view interaction stays here; Dashboard routes input and the workspace owns Jira reads. */
import { View } from "../jira/query";
import {
  BREAKDOWNS,
  type Breakdown,
  type SavedView,
  SavedViews,
  savedScope,
  type ViewPreferences,
  viewQuery,
} from "../state/views";
import { message } from "../state/workspace";
import type { Dashboard } from "./dashboard";
import { type Key, keyId } from "./input";
import { type Bucket, breakdown } from "./view-breakdown";
import { type ViewField, ViewForm } from "./view-form";

export class ViewPanel {
  readonly saved: SavedViews;
  form: ViewForm | null = null;

  constructor(
    private readonly dashboard: Dashboard,
    preferences?: ViewPreferences,
  ) {
    this.saved = new SavedViews(preferences);
  }

  get active() {
    return this.saved.active;
  }
  get current() {
    return this.saved.current;
  }
  get chart(): boolean {
    return !!this.active && this.active.bucket === null;
  }
  get buckets(): Bucket[] {
    return this.active ? breakdown(this.dashboard.workspace.issues, this.active.breakdown) : [];
  }

  get bucket(): Bucket | undefined {
    return this.buckets.find((bucket) => bucket.id === this.active?.bucket);
  }

  get cursor(): number {
    return Math.max(0, Math.min(this.active?.cursor ?? 0, this.buckets.length - 1));
  }

  leave(): void {
    this.saved.active = undefined;
    this.form = null;
    this.dashboard.list.narrowTo();
  }

  create(): void {
    this.form = new ViewForm(this.dashboard.workspace.board);
  }

  open(id: string): void {
    const view = this.saved.all.find((record) => record.id === id);
    if (!view) return;
    const d = this.dashboard;
    d.peekOpen = false;
    d.showScope(viewQuery(view.scope), view.board);
    d.list.filter("");
    this.saved.open(id);
    d.personLabel = view.personLabel;
  }

  field(field: ViewField): void {
    if (!this.form) return;
    this.form.field = field;
    if (field !== "name") this.dashboard.openPicker(field === "breakdown" ? "view-draft-breakdown" : `view-${field}`);
  }

  formKey(key: Key): void {
    const result = this.form?.handle(key);
    if (result === "cancel") this.form = null;
    else if (result === "save") this.saveForm();
    else if (result) this.field(result);
  }

  saveForm(): void {
    const form = this.form;
    if (!form) return;
    if (!form.draft.name.trim()) {
      form.error = "Enter a view name";
      form.field = "name";
      return;
    }
    try {
      const view = this.saved.save({ ...form.draft, board: form.draft.board || this.dashboard.workspace.board });
      this.form = null;
      this.open(view.id);
    } catch (error) {
      form.error = `Could not save view: ${message(error)}`;
    }
  }

  saveChanges(): void {
    const { current, active } = this;
    if (!current || !active) return;
    const d = this.dashboard;
    try {
      this.saved.save(
        {
          ...current,
          scope: savedScope(d.workspace.query),
          board: d.workspace.board,
          personLabel: d.personLabel,
          breakdown: active.breakdown,
        },
        current.id,
      );
      d.notify("View saved");
    } catch (error) {
      d.notify(`Could not save view: ${message(error)}`);
    }
  }

  remove(): void {
    const id = this.current?.id;
    if (!id) return;
    try {
      this.saved.remove(id);
      this.dashboard.showPage(View.Team);
    } catch (error) {
      this.dashboard.notify(`Could not delete view: ${message(error)}`);
    }
  }

  chooseBreakdown(kind: Breakdown): void {
    if (!this.active) return;
    this.active.breakdown = kind;
    this.back();
  }

  back(): void {
    if (this.active) {
      this.active.bucket = null;
      this.active.cursor = 0;
    }
    this.dashboard.peekOpen = false;
    this.dashboard.list.filter("");
    this.dashboard.list.narrowTo();
  }

  drill(id: string): void {
    const active = this.active;
    if (!active) return;
    active.bucket = id;
    const kind = active.breakdown;
    this.dashboard.list.unfold();
    this.dashboard.list.narrowTo((issues) => breakdown(issues, kind).find((bucket) => bucket.id === id)?.issues ?? []);
  }

  key(key: Key): boolean {
    const active = this.active;
    if (!active) return false;
    const id = keyId(key);
    if (id === "escape" && !this.chart && (this.dashboard.peekOpen || this.dashboard.list.search)) return false;
    if (id === "escape") {
      this.back();
      return true;
    }
    if (id === "[" || id === "]") {
      const step = id === "[" ? -1 : 1;
      this.chooseBreakdown(
        BREAKDOWNS[(BREAKDOWNS.indexOf(active.breakdown) + step + BREAKDOWNS.length) % BREAKDOWNS.length] ?? "status",
      );
      return true;
    }
    if (!this.chart) return false;
    const count = this.buckets.length;
    active.cursor = this.cursor;
    const step = id === "j" || id === "down" ? 1 : id === "k" || id === "up" ? -1 : 0;
    if (step || id === "home" || id === "end" || id === "pagedown" || id === "pageup") {
      const delta = id === "pagedown" ? 10 : id === "pageup" ? -10 : step;
      active.cursor = Math.max(
        0,
        Math.min(count - 1, id === "home" ? 0 : id === "end" ? count - 1 : active.cursor + delta),
      );
      return true;
    }
    if (id === "enter") {
      const bucket = this.buckets[active.cursor];
      if (bucket) this.drill(bucket.id);
      return true;
    }
    // List-only shortcuts cannot select invisible issues beneath a chart.
    return [" ", "v", "o", "y", "z", "Z", "g", "/", "left", "right"].includes(id);
  }

  changedScope(): void {
    if (this.active) this.back();
  }

  chooseScope(view: SavedView["scope"]["view"]): void {
    const form = this.form;
    if (!form) return;
    if (view === View.Mine) {
      form.draft.scope.assignee = "";
      form.draft.personLabel = "All people";
    }
    form.draft.scope.view = view;
  }
}
