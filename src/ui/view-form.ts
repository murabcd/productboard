/** The creation dialog reuses the workspace's native single-line editor and picker controls. */

import { ALL_ASSIGNEES } from "../jira/assignee";
import { View } from "../jira/query";
import type { ViewDraft } from "../state/views";
import { BREAKDOWN_NAMES } from "../state/views";
import { assigneeLabel } from "./assignee-picker";
import type { Canvas } from "./canvas";
import { button } from "./controls";
import { type DialogFrame, dialogPanel } from "./dialog";
import { type Key, keyId, type SearchEdit } from "./input";
import { pageOf } from "./navigation";

export const VIEW_FIELDS = ["name", "scope", "breakdown", "project", "sprint", "assignee"] as const;
export type ViewField = (typeof VIEW_FIELDS)[number];
export type ViewChoiceField = Exclude<ViewField, "name">;
const FIELD_NAMES: Record<ViewChoiceField, string> = {
  scope: "Issues from",
  breakdown: "Breakdown",
  project: "Project",
  sprint: "Sprint",
  assignee: "Assignee",
};

export class ViewForm {
  readonly draft: ViewDraft;
  field: ViewField = "name";
  error = "";

  constructor(board: string) {
    this.draft = {
      name: "",
      board,
      breakdown: "status",
      scope: { view: View.Team, project: "", sprintFilter: null, assignee: ALL_ASSIGNEES, status: "all" },
    };
  }

  get searchEdit(): SearchEdit | undefined {
    if (this.field !== "name") return undefined;
    return {
      owner: this,
      text: this.draft.name,
      placeholder: "Name",
      limit: 45,
      change: (text) => {
        this.draft.name = text;
        this.error = "";
      },
    };
  }

  handle(key: Key): "cancel" | "save" | ViewChoiceField | undefined {
    const id = keyId(key);
    if (id === "escape" || id === "ctrl-c") return "cancel";
    if (id === "agent-send-now") return "save";
    if (id === "tab" || id === "up" || id === "down") {
      const step = id === "up" || ("name" in key && key.shift) ? -1 : 1;
      this.field =
        VIEW_FIELDS[(VIEW_FIELDS.indexOf(this.field) + step + VIEW_FIELDS.length) % VIEW_FIELDS.length] ?? "name";
    }
    if (id === "enter" && this.field !== "name") return this.field;
  }
}

export function viewFormDialog(
  viewport: Pick<Canvas, "width" | "height">,
  form: ViewForm,
  sprint: string,
): DialogFrame {
  const frame = dialogPanel(viewport, form.error ? 17 : 15, "New view");
  const { panel } = frame;
  panel.search(
    3,
    3,
    panel.width - 6,
    {
      text: form.draft.name,
      placeholder: "Name",
    },
    form.field === "name",
  );
  panel.mark(3, 3, panel.width - 6, { kind: "view-field", field: "name" });
  const { draft } = form;
  const values: Record<ViewChoiceField, string> = {
    scope: draft.scope.view === View.Created ? "Created by me" : pageOf(draft.scope.view).name,
    breakdown: BREAKDOWN_NAMES[draft.breakdown],
    project: draft.scope.project || "All projects",
    sprint,
    assignee: draft.scope.view === View.Mine ? "You" : assigneeLabel(draft.scope.assignee),
  };
  VIEW_FIELDS.slice(1).forEach((field, index) => {
    if (field === "name") return;
    const y = 5 + index;
    panel.put(y, 3, FIELD_NAMES[field], "muted");
    button(panel, y, 16, {
      label: `${values[field]} ▾`,
      target: { kind: "view-field", field },
      tab: form.field === field ? "selected" : "unselected",
    });
  });
  if (form.error) panel.put(11, 3, form.error, "error", panel.width - 6);
  panel.put(panel.height - 2, 3, "tab Next   esc Cancel   ^↵ Create view", "muted", panel.width - 6);
  return frame;
}
