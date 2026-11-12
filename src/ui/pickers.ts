import { type AgentModel, modelName, PROVIDER_NAMES, REASONING_NAMES } from "../agent/models";
import { REASONING_LEVELS, type Reasoning } from "../auth";
import { isPersonal, STATUSES, type StatusFilter, View } from "../jira/query";
import { type Choice, describeAttachment, SPRINT_STATES, shortSprintName, sprintChoice } from "../jira/types";
import { THEME_IDS, THEMES } from "../theme";
import type { Dashboard } from "./dashboard";
import { NAVIGATION, navKey } from "./navigation";
import type { PickerItem, PickerKind, PickerOptions } from "./picker";

const STATUS_LABELS: Record<StatusFilter, string> = { all: "All statuses", open: "Open", done: "Done" };

export function filterChips(d: Dashboard): string[] {
  const { project, assignee, status, view, sprintFilter } = d.workspace.query;
  const chips: string[] = [];
  if (project) chips.push(`Project: ${project}`);
  if (sprintFilter !== null) {
    chips.push(shortSprintName(sprintFilterName(d)));
  }
  if (assignee && !isPersonal(view)) chips.push(`Assignee: ${d.personLabel}`);
  if (status !== "all") chips.push(`Status: ${STATUS_LABELS[status]}`);
  return chips;
}

interface PickerSource {
  title: string;
  items(d: Dashboard, query: string): PickerItem[];
  /** Start loading what the list shows, when it isn't loaded yet. */
  load?(d: Dashboard): void;
  close?(d: Dashboard): void;
  placement?: PickerOptions["placement"];
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
  const use = (m: AgentModel) => () => {
    d.agent.useModel(m);
    d.openPicker("reasoning");
  };
  return d.agent.models
    .map((model) => {
      const provider = PROVIDER_NAMES[model.provider];
      const current = model.provider === now?.provider && model.model === now.model;
      return {
        value: `${model.provider}/${model.model}`,
        label: modelName(model.model),
        detail: current ? provider : "",
        group: current ? "Recent" : provider,
        current,
        run: use(model),
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || a.group.localeCompare(b.group));
}

function catalogStatus(error: string, pending: boolean): string {
  return error || (pending ? "Loading…" : "No matches");
}

function sprintFilterName({ workspace }: Dashboard): string {
  const { sprintFilter } = workspace.query;
  return sprintFilter === null ? "Any sprint" : (workspace.sprint()?.name ?? `Sprint ${sprintFilter}`);
}

function boardPicker(choose: (d: Dashboard, board: string) => void): PickerSource {
  return {
    title: "Choose board",
    items: (d) => fromChoices(d.workspace.boards, d.workspace.board, (board) => choose(d, board.value)),
    load: (d) => {
      if (d.workspace.boards.length === 0) d.workspace.loadCatalog();
    },
    empty: ({ workspace }) => catalogStatus(workspace.boardCatalogError, workspace.catalogPending),
  };
}

export function openSprintFilter(d: Dashboard): void {
  d.openPicker(d.workspace.board ? "sprint" : "sprint-board");
}

const sprintFilterPicker: PickerSource = {
  title: "Filter by sprint",
  items: (d) => {
    const current = d.workspace.query.sprintFilter;
    const sprints = d.workspace.sprints.map(
      (sprint): PickerItem => ({
        ...sprintChoice(sprint),
        current: sprint.id === current,
        run: () => d.changeQuery({ sprintFilter: sprint.id }),
      }),
    );
    if (current !== null || sprints.length) {
      sprints.unshift(
        item("Any sprint", "", () => d.changeQuery({ sprintFilter: null }), { current: current === null }),
      );
    }
    return sprints;
  },
  load: ({ workspace }) => {
    if (workspace.sprints.length === 0) void workspace.loadSprints();
  },
  options: (d) => {
    const { workspace } = d;
    const state = workspace.sprint()?.state ?? workspace.sprints[0]?.state;
    return { tabs: [...SPRINT_STATES, "all"], tab: state ? SPRINT_STATES.indexOf(state) : SPRINT_STATES.length };
  },
  empty: ({ workspace }) => catalogStatus(workspace.sprintCatalogError, workspace.sprintsPending),
};

const agentContext: PickerSource = {
  title: "Add context",
  placement: "completion",
  options: () => ({ filterChoices: false }),
  load: ({ workspace }) => {
    if (!workspace.board) workspace.loadCatalog();
    else if (!workspace.sprints.length) void workspace.loadSprints();
  },
  close: ({ contextPicker }) => contextPicker.close(),
  items: ({ workspace, agent, contextPicker }, query) =>
    contextPicker.items(query, workspace.sprints, workspace.issues, agent.chat.current.draft.sprint?.sprint.id),
  empty: ({ workspace }) => catalogStatus(workspace.catalogError, workspace.sprintsPending || workspace.catalogPending),
};

function commandItems(d: Dashboard): PickerItem[] {
  const { current } = d.agent;
  const page = { group: "Pages" };
  const act = { group: "Actions" };
  return [
    ...NAVIGATION.map((nav) =>
      item(`Go to ${nav.name}`, navKey(nav), () => (nav.to === "agent" ? d.openAgent() : d.showView(nav.to)), page),
    ),
    item("Go to Created", "My issues tab", () => d.showView(View.Created), page),
    ...(d.agent.tab
      ? [item("Add context", "@", () => d.openPicker("agent-context"), act)]
      : [
          item("Filter…", "F", () => d.openPicker("filter"), act),
          item("Choose board", "b", () => d.openPicker("board"), act),
          item("Filter by sprint", "s", () => openSprintFilter(d), act),
          ...(d.workspace.sprint() ? [item("Sprint brief", "t", () => d.runAction("brief"), act)] : []),
          item("Display options…", "D", () => d.openPicker("display"), act),
        ]),
    item("Change theme", THEMES[d.theme].label, () => d.openPicker("theme"), act),
    ...(d.canConnectAgent ? [item("Connect Agent", "", () => void d.connectAgent(), act)] : []),
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
  board: boardPicker((d, board) => d.chooseBoard(board)),
  "sprint-board": boardPicker((d, board) => {
    d.chooseBoard(board);
    d.openPicker("sprint");
  }),
  sprint: sprintFilterPicker,
  "agent-context": agentContext,
  "agent-commands": {
    title: "Agent commands",
    placement: "completion",
    options: () => ({ detailLayout: 16 }),
    items: (d) => [item("/models", "Switch model", () => d.openPicker("model"))],
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
    empty: ({ workspace }) => catalogStatus(workspace.boardCatalogError, workspace.catalogPending),
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
      d.attachments.map((attachment) =>
        item(attachment.filename, describeAttachment(attachment), () => d.openAttachment(attachment), {
          value: attachment.id,
        }),
      ),
  },
  model: {
    placement: "composer",
    options: () => ({ placeholder: "Search models", keepGroupHeading: true, detailLayout: "inline" }),
    title: "Select model",
    items: modelItems,
    load: (d) => d.agent.loadModels(),
    empty: (d) => (d.agent.modelsPending ? "Loading models…" : d.agent.modelsError || "No matches"),
  },
  reasoning: {
    title: "Select reasoning",
    placement: "composer",
    options: () => ({ placeholder: "Select reasoning" }),
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
    title: "Filter",
    items: (d) => {
      const { query } = d.workspace;
      const person = isPersonal(query.view) ? "You" : query.assignee ? d.personLabel : "Anyone";
      const active = filterChips(d).length;
      const board = d.workspace.boards.find(({ value }) => value === d.workspace.board);
      return [
        item("Project", query.project || "Any project", () => d.openPicker("project")),
        item("Sprint", sprintFilterName(d), () => openSprintFilter(d)),
        item("Sprint board", board?.label ?? "Choose a board", () => d.openPicker("board")),
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
  theme: {
    title: "Choose theme",
    items: (d) =>
      THEME_IDS.map((theme) =>
        item(THEMES[theme].label, "", () => d.chooseTheme(theme), { value: theme, current: d.theme === theme }),
      ),
  },
  commands: { title: "Commands", items: commandItems },
};
