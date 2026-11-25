/** Draft selectors use the same picker and catalog choices as issue filters. */
import { View } from "../jira/query";
import { sprintChoice } from "../jira/types";
import { BREAKDOWN_NAMES, BREAKDOWNS, VIEW_SCOPES } from "../state/views";
import { assigneePicker } from "./assignee-picker";
import { projectChoices } from "./filter-choices";
import { pageOf } from "./navigation";
import type { PickerSource } from "./pickers";

export const VIEW_PICKERS = {
  "saved-views": {
    title: "Views",
    items: (d) => [
      { value: "new", label: "+ New view", detail: "^N", run: () => d.views.create() },
      ...d.views.saved.all.map((view) => ({
        value: view.id,
        label: view.name,
        detail: BREAKDOWN_NAMES[view.breakdown],
        current: view.id === d.views.current?.id,
        run: () => d.views.open(view.id),
      })),
    ],
  },
  "view-delete": {
    title: "Delete view?",
    items: (d) => [
      { value: "cancel", label: "Keep view", detail: "", run: () => {} },
      { value: "delete", label: "Delete view", detail: d.views.current?.name ?? "", run: () => d.views.remove() },
    ],
  },
  "view-breakdown": {
    title: "Breakdown",
    items: (d) =>
      BREAKDOWNS.map((kind) => ({
        value: kind,
        label: BREAKDOWN_NAMES[kind],
        detail: "",
        current: kind === d.views.active?.breakdown,
        run: () => d.views.chooseBreakdown(kind),
      })),
  },
  "view-scope": {
    title: "Issues from",
    items: (d) =>
      VIEW_SCOPES.map((view) => ({
        value: String(view),
        label: view === View.Created ? "Created by me" : pageOf(view).name,
        detail: "",
        current: view === d.views.form?.draft.scope.view,
        run: () => d.views.chooseScope(view),
      })),
  },
  "view-project": {
    title: "Project",
    load: (d) => {
      if (!d.workspace.projects.length) d.workspace.loadCatalog();
    },
    items: (d) =>
      projectChoices(d.workspace.projects).map((choice) => ({
        ...choice,
        current: choice.value === d.views.form?.draft.scope.project,
        run: () => {
          if (d.views.form) d.views.form.draft.scope.project = choice.value;
        },
      })),
  },
  "view-sprint": {
    title: "Sprint",
    load: (d) => {
      if (!d.workspace.board) d.workspace.loadCatalog();
      else void d.workspace.loadSprints();
    },
    items: (d) =>
      [{ value: "", label: "Any sprint", detail: "", state: "" }, ...d.workspace.sprints.map(sprintChoice)].map(
        (choice) => ({
          ...choice,
          current: choice.value === String(d.views.form?.draft.scope.sprintFilter ?? ""),
          run: () => {
            const form = d.views.form;
            if (!form) return;
            form.draft.scope.sprintFilter = choice.value ? Number(choice.value) : null;
            form.draft.board = d.workspace.board;
          },
        }),
      ),
  },
  "view-assignee": assigneePicker(true),
  "view-draft-breakdown": {
    title: "Breakdown",
    items: (d) =>
      BREAKDOWNS.map((kind) => ({
        value: kind,
        label: BREAKDOWN_NAMES[kind],
        detail: "",
        current: kind === d.views.form?.draft.breakdown,
        run: () => {
          if (d.views.form) d.views.form.draft.breakdown = kind;
        },
      })),
  },
} satisfies Record<string, PickerSource>;
export type ViewPickerKind = keyof typeof VIEW_PICKERS;
