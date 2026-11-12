/** Shared page title, description and toolbar controls. */

import { MENTION_DAYS, View } from "../jira/query";
import type { Canvas } from "./canvas";
import { action, buttons, buttonsRight, type Control } from "./controls";
import type { Dashboard } from "./dashboard";
import type { headerRows } from "./layout";
import { AGENT, MY_ISSUES_TABS, pageOf } from "./navigation";
import { filterChips } from "./pickers";

export interface PageHeader {
  title: string;
  description: string;
  tabs: Control[];
  filters: Control[];
  actions: Control[];
}

const DESCRIPTIONS: Record<View, string> = {
  [View.Mentions]: `Comments that mention you, in issues updated in ${MENTION_DAYS} days`,
  [View.Mine]: "Issues assigned to you",
  [View.Created]: "Issues you created",
  [View.Today]: "What needs attention across active sprints",
  [View.All]: "Everyone's issues across projects",
  [View.Search]: "Issue titles, descriptions and comments",
};

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
  return {
    title: AGENT.name,
    description: "Search across Jira",
    tabs: [],
    filters: [],
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
    description: DESCRIPTIONS[view],
    tabs: [],
    filters,
    actions: [{ label: "Display ▾", target: action("display") }],
  };
  if (view === View.All && work.sprint()) {
    header.actions.unshift({ label: "Sprint brief", target: action("brief") });
  }
  if (pageOf(view).to === View.Mine) {
    header.tabs = MY_ISSUES_TABS.map(([tab, label]) => ({
      label,
      target: { kind: "view", view: tab },
      tab: tab === view ? "selected" : "unselected",
    }));
  }
  return header;
}

export function pageHeader(d: Dashboard): PageHeader {
  return d.agent.tab ? agentHeader(d) : issuesHeader(d);
}

export function drawHeader(canvas: Canvas, header: PageHeader, rows: ReturnType<typeof headerRows>): void {
  const { width } = canvas;
  canvas.put(rows.description, 2, header.description, "muted", width - 4);
  const right = header.actions.length ? buttonsRight(canvas, rows.toolbar, width - 2, header.actions) - 2 : width - 2;
  const afterTabs = buttons(canvas, rows.toolbar, 2, header.tabs, right);
  buttons(canvas, rows.toolbar, header.tabs.length ? afterTabs + 2 : 2, header.filters, right);
}
