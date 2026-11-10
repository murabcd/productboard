import { type AgentModel, modelName, PROVIDER_NAMES, REASONING_NAMES } from "../agent/models";
import { REASONING_LEVELS, type Reasoning } from "../auth";
import { isPersonal, STATUSES, type StatusFilter, View } from "../jira/query";
import {
  type Choice,
  describeAttachment,
  SPRINT_STATES,
  type Sprint,
  shortSprintName,
  sprintChoice,
} from "../jira/types";
import { THEME_IDS, THEMES } from "../theme";
import type { Dashboard } from "./dashboard";
import { NAVIGATION, navKey } from "./navigation";
import type { PickerItem, PickerKind, PickerOptions } from "./picker";

const STATUS_LABELS: Record<StatusFilter, string> = { all: "All statuses", open: "Open", done: "Done" };

export function filterChips(d: Dashboard): string[] {
  const { project, assignee, status, view, sprintFilter } = d.workspace.query;
  const chips: string[] = [];
  if (project) chips.push(`Project: ${project}`);
  if (view !== View.Sprint && sprintFilter !== null) {
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
  queryChanged?(d: Dashboard, query: string): void;
  close?(d: Dashboard): void;
  options?(d: Dashboard): PickerOptions;
  /** What the list says while empty: still loading, a failure, or no matches. */
  empty?(d: Dashboard): string;
  status?(d: Dashboard): string;
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

function catalogStatus(error: string, pending: boolean): string {
  return error || (pending ? "Loading…" : "No matches");
}

function sprintFilterName({ workspace }: Dashboard): string {
  const { sprintFilter } = workspace.query;
  return sprintFilter === null ? "Any sprint" : (workspace.sprint(sprintFilter)?.name ?? `Sprint ${sprintFilter}`);
}

function boardPicker(next: "sprint" | "sprint-filter"): PickerSource {
  return {
    title: "Choose board",
    items: (d) => fromChoices(d.workspace.boards, d.workspace.board, (board) => d.chooseBoard(board.value, next)),
    load: (d) => {
      if (d.workspace.boards.length === 0) d.workspace.loadCatalog();
    },
    empty: ({ workspace }) => catalogStatus(workspace.boardCatalogError, workspace.catalogPending),
  };
}

interface SprintPickerMode {
  title: string;
  selected(d: Dashboard): number | null;
  choose(d: Dashboard, sprint: Sprint): void;
  clear?(d: Dashboard): PickerItem | undefined;
}

const SPRINT_PICKERS = {
  scope: {
    title: "Choose sprint",
    selected: (d) => d.workspace.query.sprint,
    choose: (d, sprint) => d.changeQuery({ view: View.Sprint, sprint: sprint.id }),
  },
  filter: {
    title: "Filter by sprint",
    selected: (d) => d.workspace.query.sprintFilter,
    choose: (d, sprint) => d.changeQuery({ sprintFilter: sprint.id }),
    clear: (d) => {
      const current = d.workspace.query.sprintFilter === null;
      if (!current || d.workspace.sprints.length) {
        return item("Any sprint", "", () => d.changeQuery({ sprintFilter: null }), { current });
      }
    },
  },
} satisfies Record<string, SprintPickerMode>;

function sprintPicker({ title, selected, choose, clear }: SprintPickerMode): PickerSource {
  return {
    title,
    items: (d) => {
      const current = selected(d);
      const sprints = d.workspace.sprints.map(
        (sprint): PickerItem => ({
          ...sprintChoice(sprint),
          current: sprint.id === current,
          run: () => choose(d, sprint),
        }),
      );
      const reset = clear?.(d);
      if (reset) sprints.unshift(reset);
      return sprints;
    },
    load: ({ workspace }) => {
      if (!workspace.board) workspace.loadCatalog();
      else if (workspace.sprints.length === 0) void workspace.loadSprints();
    },
    options: (d) => {
      const { workspace } = d;
      const state = workspace.sprint(selected(d))?.state ?? workspace.sprints[0]?.state;
      return { tabs: [...SPRINT_STATES, "all"], tab: state ? SPRINT_STATES.indexOf(state) : SPRINT_STATES.length };
    },
    empty: ({ workspace }) =>
      catalogStatus(
        workspace.sprintCatalogError || workspace.boardCatalogError,
        workspace.sprintsPending || workspace.catalogPending,
      ),
  };
}

const agentContext: PickerSource = {
  title: "Add context",
  options: () => ({ placeholder: "Search tasks and sprints", filterChoices: false }),
  load: ({ workspace }) => {
    if (!workspace.board) workspace.loadCatalog();
    else if (!workspace.sprints.length) void workspace.loadSprints();
  },
  queryChanged: ({ agent }, query) => void agent.searchContext(query),
  close: ({ agent }) => agent.clearContextSearch(),
  items: ({ workspace, agent }, query) => {
    const needle = query.trim().toLocaleLowerCase();
    const current = agent.chat.current.draft.sprint?.sprint.id;
    const matches = (text: string) => text.toLocaleLowerCase().includes(needle);
    const sprints = workspace.sprints.filter(({ name }) => matches(name)).slice(0, needle ? 12 : 4);
    const issues = new Map(
      workspace.issues.filter(({ key, summary }) => matches(`${key} ${summary}`)).map((issue) => [issue.key, issue]),
    );
    const search = agent.contextSearch;
    if (search?.kind === "results") {
      for (const issue of search.issues) issues.set(issue.key, issue);
    }
    const tasks = Array.from(issues.values()).slice(0, needle ? 12 : 4);
    return [
      ...sprints.map((sprint) => ({
        ...sprintChoice(sprint),
        group: "Sprints",
        current: sprint.id === current,
        run: () => agent.attachReference?.({ kind: "sprint", sprint: { id: sprint.id, name: sprint.name } }),
      })),
      ...tasks.map((issue) =>
        item(
          `${issue.key}  ${issue.summary}`,
          issue.status,
          () => agent.attachReference?.({ kind: "issue", key: issue.key }),
          {
            value: issue.key,
            group: "Tasks",
          },
        ),
      ),
    ];
  },
  empty: ({ workspace }) => catalogStatus(workspace.catalogError, workspace.sprintsPending || workspace.catalogPending),
  status: ({ agent }) => {
    const search = agent.contextSearch;
    if (search?.kind === "pending") return "Searching Jira…";
    if (search?.kind === "error") return `Jira search failed: ${search.message}`;
    return "";
  },
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
          item("Choose sprint", "s", () => d.openPicker("sprint"), act),
          item("Sprint brief", "t", () => d.runAction("brief"), act),
          item("Display options…", "D", () => d.openPicker("display"), act),
        ]),
    item("Change theme", THEMES[d.theme].label, () => d.openPicker("theme"), act),
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
  board: boardPicker("sprint"),
  "sprint-filter-board": boardPicker("sprint-filter"),
  sprint: sprintPicker(SPRINT_PICKERS.scope),
  "sprint-filter": sprintPicker(SPRINT_PICKERS.filter),
  "agent-context": agentContext,
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
    options: () => ({ placeholder: "Search models" }),
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
    title: "Filter",
    items: (d) => {
      const { query } = d.workspace;
      const person = isPersonal(query.view) ? "You" : query.assignee ? d.personLabel : "Anyone";
      const sprint =
        query.view === View.Sprint
          ? item("Sprint", d.workspace.sprint()?.name ?? "Choose a sprint", () => d.openPicker("sprint"))
          : item("Sprint", sprintFilterName(d), () => d.openPicker("sprint-filter"));
      const active = filterChips(d).length;
      return [
        item("Project", query.project || "Any project", () => d.openPicker("project")),
        sprint,
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
