import { type AgentModel, modelName, PROVIDER_NAMES, REASONING_NAMES } from "../agent/models";
import { REASONING_LEVELS, type Reasoning } from "../auth";
import { isPersonal, STATUSES, type StatusFilter, View } from "../jira/query";
import { type Choice, describeAttachment, SPRINT_STATES, sprintChoice } from "../jira/types";
import type { Dashboard } from "./dashboard";
import { NAVIGATION, navKey } from "./navigation";
import type { PickerItem, PickerKind, PickerOptions } from "./picker";

const STATUS_LABELS: Record<StatusFilter, string> = { all: "All statuses", open: "Open", done: "Done" };

export type FilterChip = "project" | "assignee" | "status";

export function filterChips(d: Dashboard): [FilterChip, string][] {
  const { project, assignee, status, view } = d.workspace.query;
  const chips: [FilterChip, string][] = [];
  if (project) chips.push(["project", `Project: ${project}`]);
  if (assignee && !isPersonal(view)) chips.push(["assignee", `Assignee: ${d.personLabel}`]);
  if (status !== "all") chips.push(["status", `Status: ${STATUS_LABELS[status]}`]);
  return chips;
}

interface PickerSource {
  title: string;
  items(d: Dashboard): PickerItem[];
  /** Start loading what the list shows, when it isn't loaded yet. */
  load?(d: Dashboard): void;
  options?(d: Dashboard): PickerOptions;
  /** What the list says while empty: still loading, a failure, or no matches. */
  empty?(d: Dashboard): string;
}

const item = (label: string, detail: string, run: () => void, extra: Partial<PickerItem> = {}): PickerItem => ({
  value: label,
  label,
  detail,
  run,
  ...extra,
});

const fromChoices = (choices: Choice[], current: string | null, run: (choice: Choice) => void): PickerItem[] =>
  choices.map((choice) => ({ ...choice, current: choice.value === current, run: () => run(choice) }));

const REASONING_DETAILS: Record<Reasoning, string> = {
  none: "Answers right away",
  low: "Quick answers",
  medium: "Balanced · default",
  high: "Thinks longer",
  xhigh: "Thinks longest",
};

/** The active model appears under Recent. Other models are grouped by provider. */
function modelItems(d: Dashboard): PickerItem[] {
  const now = d.agent.current;
  const inUse = (m: AgentModel) => m.provider === now?.provider && m.model === now.model;
  const use = (m: AgentModel) => () => {
    d.agent.useModel(m);
    d.openPicker("reasoning");
  };
  const value = (m: AgentModel) => `${m.provider}/${m.model}`;
  return d.agent.models
    .toSorted((a, b) => Number(inUse(b)) - Number(inUse(a)))
    .map((m) =>
      inUse(m)
        ? {
            value: value(m),
            label: modelName(m.model),
            detail: PROVIDER_NAMES[m.provider],
            group: "Recent",
            current: true,
            run: use(m),
          }
        : { value: value(m), label: modelName(m.model), detail: "", group: PROVIDER_NAMES[m.provider], run: use(m) },
    );
}

function catalogStatus(d: Dashboard): string {
  const work = d.workspace;
  if (work.catalogError) return work.catalogError;
  return work.catalogPending || work.sprintsPending ? "Loading…" : "No matches";
}

function commandItems(d: Dashboard): PickerItem[] {
  const { current } = d.agent;
  const page = { group: "Pages" };
  const act = { group: "Actions" };
  return [
    ...NAVIGATION.map((nav) =>
      item(`Go to ${nav.name}`, navKey(nav), () => (nav.to === "agent" ? d.openAgent() : d.showView(nav.to)), page),
    ),
    item("Go to Created", "My issues tab", () => d.showView(View.Created), page),
    item("Filter issues…", "F", () => d.openPicker("filter"), act),
    item("Display options…", "D", () => d.openPicker("display"), act),
    item("Choose board", "b", () => d.openPicker("board"), act),
    item("Choose sprint", "s", () => d.openPicker("sprint"), act),
    item("Sprint brief", "t", () => d.runAction("brief"), act),
    item("Select Agent model", current ? modelName(current.model) : "Not set up", () => d.openPicker("model"), act),
    item(
      "Select reasoning",
      current ? REASONING_NAMES[current.reasoning] : "Not set up",
      () => d.openPicker("reasoning"),
      act,
    ),
    item("Toggle issue peek", "Space", () => d.runAction("peek"), act),
    item("Open an issue Agent mentioned", "^O", () => d.openPicker("cited"), act),
    item("Open issue details", "Enter", () => d.runAction("details"), act),
    item("Open issue in Helium", "o", () => d.openIssue(false), act),
    item("Copy issue link", "y", () => d.openIssue(true), act),
    item("Search all of Jira", "f", () => d.startFind(), act),
    item("Refresh", "r", () => d.runAction("refresh"), act),
    item("Keyboard shortcuts", "?", () => d.runAction("help"), act),
  ];
}

export const PICKERS: Record<PickerKind, PickerSource> = {
  board: {
    title: "Choose board",
    items: (d) => fromChoices(d.workspace.boards, d.workspace.board, (board) => d.chooseBoard(board.value)),
    load: (d) => {
      if (d.workspace.boards.length === 0) d.workspace.loadCatalog();
    },
    empty: catalogStatus,
  },
  sprint: {
    title: "Choose sprint",
    items: (d) => {
      const { sprint } = d.workspace.query;
      return fromChoices(d.workspace.sprints.map(sprintChoice), sprint === null ? null : String(sprint), (choice) =>
        d.changeQuery({ view: View.Sprint, sprint: Number(choice.value) }),
      );
    },
    load: (d) => {
      if (d.workspace.sprints.length === 0 && !d.workspace.sprintsPending) d.workspace.loadSprints();
    },
    // Tabs start on the first state that has sprints: active, then planned, then closed.
    options: (d) => {
      const present = new Set(d.workspace.sprints.map((s) => s.state));
      return {
        tabs: [...SPRINT_STATES, "all"],
        tab: Math.max(
          0,
          SPRINT_STATES.findIndex((state) => present.has(state)),
        ),
      };
    },
    empty: catalogStatus,
  },
  project: {
    title: "Choose project",
    items: (d) =>
      fromChoices(
        [{ value: "", label: "All projects", detail: "", state: "" }, ...d.workspace.projects],
        d.workspace.query.project,
        (project) => d.changeQuery({ project: project.value }),
      ),
    load: (d) => {
      if (d.workspace.boards.length === 0) d.workspace.loadCatalog();
    },
    empty: catalogStatus,
  },
  assignee: {
    title: "People in loaded issues",
    items: (d) => {
      const issues = d.workspace.issues.filter((i) => i.assigneeId);
      const people = [...new Map(issues.map((i) => [i.assigneeId, i.assignee]))].sort(([, a], [, b]) =>
        a.localeCompare(b),
      );
      const choices: Choice[] = [
        { value: "", label: "All people", detail: "", state: "" },
        { value: "unassigned", label: "Unassigned", detail: "", state: "" },
        ...people.map(([id, name]) => ({ value: id, label: name, detail: "", state: "" })),
      ];
      return fromChoices(choices, d.workspace.query.assignee, (person) => d.chooseAssignee(person.value, person.label));
    },
  },
  status: {
    title: "Status",
    items: (d) =>
      STATUSES.map((status) =>
        item(STATUS_LABELS[status], "", () => d.changeQuery({ status }), {
          current: status === d.workspace.query.status,
        }),
      ),
  },
  attachment: {
    title: "Attachments · Enter previews images, opens other files in Helium",
    items: (d) =>
      (d.modal?.attachments ?? []).map((attachment) =>
        item(attachment.filename, describeAttachment(attachment), () => d.openAttachment(attachment), {
          value: attachment.id,
        }),
      ),
  },
  model: {
    title: "Select model",
    items: modelItems,
    load: (d) => d.agent.loadModels(),
    empty: (d) => (d.agent.modelsPending ? "Loading models…" : d.agent.modelsError || "No matches"),
  },
  reasoning: {
    title: "Select reasoning",
    items: (d) =>
      REASONING_LEVELS.map((level) =>
        item(REASONING_NAMES[level], REASONING_DETAILS[level], () => d.agent.useReasoning(level), {
          current: level === d.agent.current?.reasoning,
        }),
      ),
  },
  cited: {
    title: "Issues Agent mentioned",
    items: (d) =>
      [...d.agent.chat.current.issues.values()].map((issue) =>
        item(issue.key, issue.summary, () => d.openDetail(issue)),
      ),
  },
  filter: {
    title: "Filter issues",
    items: (d) => {
      const { query } = d.workspace;
      const person = isPersonal(query.view) ? "You" : query.assignee ? d.personLabel : "Anyone";
      const active = filterChips(d).length;
      return [
        item("Project", query.project || "Any project", () => d.openPicker("project")),
        item("Assignee", person, () => d.openPicker("assignee")),
        item("Status", STATUS_LABELS[query.status], () => d.openPicker("status")),
        item("Filter loaded issues", d.list.search ? `“${d.list.search}”` : "Type to narrow the list", () => {
          d.searching = true;
        }),
        item("Clear filters", active ? `${active} active` : "None active", () => d.clearFilters()),
      ];
    },
  },
  display: {
    title: "Display",
    items: (d) => [
      item("Group by status", "Blocked, in progress, review, done", () => d.list.groupBy("status"), {
        current: d.list.grouping === "status",
      }),
      item("Group by assignee", "One group per person", () => d.list.groupBy("assignee"), {
        current: d.list.grouping === "assignee",
      }),
    ],
  },
  commands: { title: "Commands", items: commandItems },
};
