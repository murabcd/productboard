/** Shared multi-person draft: toggles stay local until the user applies the filter. */
import { ALL_ASSIGNEES, type AssigneeFilter, type AssigneePerson } from "../jira/assignee";
import { View } from "../jira/query";
import type { Issue } from "../jira/types";
import type { Dashboard } from "./dashboard";
import { assigneeChoices } from "./filter-choices";
import type { PickerItem } from "./picker";
import type { PickerSource } from "./pickers";

export function assigneeLabel(filter: AssigneeFilter): string {
  if (!filter.people.length) return "All people";
  const names = filter.people
    .slice(0, 2)
    .map((person) => person.label)
    .join(", ");
  const more = filter.people.length > 2 ? ` +${filter.people.length - 2}` : "";
  return `${filter.mode === "exclude" ? "Exclude " : ""}${names}${more}`;
}

export class AssigneeSelection {
  value: AssigneeFilter;
  private people: AssigneePerson[];

  constructor(filter: AssigneeFilter, issues: readonly Issue[]) {
    this.value = { mode: filter.mode, people: [...filter.people] };
    this.people = assigneeChoices(issues, filter.people).map(({ value: id, label }) => ({ id, label }));
  }

  items(apply: () => void, issues: readonly Issue[]): PickerItem[] {
    this.people = assigneeChoices(issues, this.people).map(({ value: id, label }) => ({ id, label }));
    return [
      ...(["include", "exclude"] as const).map((mode) => ({
        value: `mode:${mode}`,
        label: mode === "include" ? "Include" : "Exclude",
        detail: mode === "include" ? "Only selected people" : "Except selected people",
        current: mode === this.value.mode,
        keepOpen: true,
        run: () => {
          this.value = { ...this.value, mode };
        },
      })),
      { value: "apply", label: "Apply filter", detail: "^↵", run: apply },
      {
        value: "clear",
        label: "Clear selection",
        detail: "All people",
        keepOpen: true,
        run: () => {
          this.value = { ...this.value, people: [] };
        },
      },
      ...this.people.map((person) => ({
        value: `person:${person.id}`,
        label: person.label,
        detail: "",
        checked: this.value.people.some(({ id }) => id === person.id),
        keepOpen: true,
        run: () => {
          const selected = this.value.people.some(({ id }) => id === person.id);
          this.value = {
            ...this.value,
            people: selected ? this.value.people.filter(({ id }) => id !== person.id) : [...this.value.people, person],
          };
        },
      })),
    ];
  }
}

export function assigneePicker(draft = false): PickerSource {
  const apply = (d: Dashboard, selection: AssigneeSelection) => {
    const filter = selection.value.people.length ? selection.value : ALL_ASSIGNEES;
    if (!draft) d.chooseAssignee(filter);
    else if (d.views.form) {
      const { scope } = d.views.form.draft;
      if (scope.view === View.Mine && filter.people.length) scope.view = View.Team;
      scope.assignee = filter;
    }
  };
  return {
    title: "Assignee · people in loaded issues",
    options: (d) => {
      const filter = draft ? d.views.form?.draft.scope.assignee : d.workspace.query.assignee;
      const selection = new AssigneeSelection(filter ?? ALL_ASSIGNEES, d.workspace.issues);
      d.assignees = selection;
      return { submit: () => apply(d, selection), hint: "↵ Toggle   ^↵ Apply   esc Cancel" };
    },
    items: (d) => {
      const selection = d.assignees;
      return selection?.items(() => apply(d, selection), d.workspace.issues) ?? [];
    },
    close: (d) => {
      d.assignees = null;
    },
  };
}
