/** Shared page title, description and toolbar controls. */

import { choiceLabel } from "../agent/models";
import { MENTION_DAYS, View } from "../jira/query";
import { SPRINT_STATE_NAMES, type SprintState, shortSprintName, sprintDates } from "../jira/types";
import { cells } from "../text";
import type { Canvas, Style } from "./canvas";
import { action, buttons, buttonsRight, type Control } from "./controls";
import type { Dashboard } from "./dashboard";
import { AGENT, MY_ISSUES_TABS, pageOf } from "./navigation";
import { filterChips } from "./pickers";

export interface PageHeader {
  title: string;
  /** Shown after the title, e.g. "● Active · Nov 3–17". */
  status?: [text: string, style: Style];
  description: string;
  tabs: Control[];
  filters: Control[];
  actions: Control[];
}

const DESCRIPTIONS: Record<Exclude<View, typeof View.Sprint>, string> = {
  [View.Mentions]: `Comments that mention you, in issues updated in ${MENTION_DAYS} days`,
  [View.Mine]: "Issues assigned to you",
  [View.Created]: "Issues you created",
  [View.Today]: "What needs attention across active sprints",
  [View.All]: "Everyone's issues across projects",
  [View.Search]: "Issue titles, descriptions and comments",
};

const SPRINT_STATUS: Record<SprintState, [icon: string, style: Style]> = {
  active: ["●", "done"],
  future: ["○", "muted"],
  closed: ["●", "muted"],
};

const boardControl: Control = { label: "Board ▾", target: action("board") };

function agentHeader(d: Dashboard): PageHeader {
  const { chat } = d.agent;
  const actions: Control[] = [];
  if (chat.size > 1) {
    actions.push(
      { label: `← ${chat.history}`, target: { kind: "agent", action: "previous" } },
      { label: "→", target: { kind: "agent", action: "next" } },
    );
  }
  if (chat.current.turns.length) actions.push({ label: "+ New chat", target: { kind: "agent", action: "new" } });
  const { current } = d.agent;
  if (current) actions.push({ label: `${choiceLabel(current)} ▾`, target: action("model") });
  return {
    title: AGENT.name,
    description: "Search across Jira",
    tabs: [],
    filters: [
      {
        label: chat.current.sprint ? `${shortSprintName(chat.current.sprint.name)} ▾` : "+ Context ▾",
        target: { kind: "agent", action: "sprint-context" },
      },
    ],
    actions,
  };
}

function issuesHeader(d: Dashboard): PageHeader {
  const work = d.workspace;
  const { view } = work.query;
  const active = filterChips(d);
  const filters: Control[] = [
    {
      label: active.length ? `Filter ${active.length} ▾` : "Filter ▾",
      target: action("filter"),
      style: active.length ? "accent" : "muted",
    },
    // Active filters show as labels; Clear filters in the Filter menu removes them.
    ...active.map((label): Control => ({ label })),
  ];
  const header: PageHeader = {
    title: pageOf(view).name,
    description: "",
    tabs: [],
    filters,
    actions: [{ label: "Display ▾", target: action("display") }],
  };
  if (view === View.Sprint) {
    const sprint = work.sprint();
    const board = work.boards.find(({ value }) => value === work.board)?.label;
    header.description = board ?? "Choose a board";
    header.filters = [boardControl, ...filters];
    if (sprint) {
      const [icon, style] = SPRINT_STATUS[sprint.state];
      const dates = sprintDates(sprint);
      header.title = shortSprintName(sprint.name);
      header.status = [`${icon} ${SPRINT_STATE_NAMES[sprint.state]}${dates ? ` · ${dates}` : ""}`, style];
      header.actions.unshift({ label: "Sprint brief", target: action("brief") });
    }
    return header;
  }
  header.description = DESCRIPTIONS[view];
  if (pageOf(view).to === View.Mine) {
    header.tabs = MY_ISSUES_TABS.map(([tab, label]) => ({
      label,
      target: { kind: "view", view: tab },
      tab: tab === view ? "selected" : "unselected",
    }));
  }
  return header;
}

const TOOLBAR = 4;

export function pageHeader(d: Dashboard): PageHeader {
  return d.agent.tab ? agentHeader(d) : issuesHeader(d);
}

export function drawPageTitle(canvas: Canvas, header: PageHeader, left: number, right: number): void {
  canvas.put(0, left, header.title, "title", right - left);
  if (header.status) {
    const x = left + cells(header.title) + 2;
    canvas.put(0, x, header.status[0], header.status[1], right - x);
  }
}

export function drawHeader(canvas: Canvas, header: PageHeader, descriptionRow: number): void {
  const { width } = canvas;
  canvas.put(descriptionRow, 2, header.description, "muted", width - 4);
  const right = header.actions.length ? buttonsRight(canvas, TOOLBAR, width - 2, header.actions) - 2 : width - 2;
  const afterTabs = buttons(canvas, TOOLBAR, 2, header.tabs, right);
  buttons(canvas, TOOLBAR, header.tabs.length ? afterTabs + 2 : 2, header.filters, right);
}
