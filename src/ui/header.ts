/** Shared page title, description and toolbar controls. */

import { MENTION_DAYS, View } from "../jira/query";
import { BREAKDOWN_NAMES, type Breakdown } from "../state/views";
import type { Canvas } from "./canvas";
import { action, buttons, buttonsRight, type Control, controlsWidth } from "./controls";
import type { Dashboard } from "./dashboard";
import { compactLayout, type headerRows } from "./layout";
import { AGENT, pageOf } from "./navigation";
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
  [View.Team]: "Browse all issues in the selected scope",
  [View.Today]: "What needs attention in the selected scope",
  [View.Search]: "Issue titles, descriptions and comments",
};

const CHART_DESCRIPTIONS: Record<Breakdown, string> = {
  status: "Loaded issues grouped by status",
  assignee: "Open issues grouped by assignee",
  age: "Open issues grouped by time since creation",
};

function agentHeader(d: Dashboard): PageHeader {
  const { chat } = d.agent;
  const actions: Control[] = [{ label: "Chats", target: { kind: "agent", action: "chats" } }];
  if (chat.size > 1) {
    actions.push(
      { label: `← ${chat.history}`, target: { kind: "agent", action: "previous" } },
      { label: "→", target: { kind: "agent", action: "next" } },
    );
  }
  if (chat.current.turns.length) actions.push({ label: "+ New chat", target: { kind: "agent", action: "new" } });
  return {
    title: AGENT.name,
    description: chat.current.name === "New chat" ? "Search across Jira" : chat.current.name,
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
  const saved = d.views.current;
  const header: PageHeader = {
    title: saved ? `${saved.name}${d.views.bucket ? ` · ${d.views.bucket.label}` : ""}` : pageOf(view).name,
    description: DESCRIPTIONS[view],
    tabs: [],
    filters,
    actions: [{ label: "Display ▾", target: action("display") }],
  };
  if (saved && d.views.active) {
    header.description = d.views.chart
      ? CHART_DESCRIPTIONS[d.views.active.breakdown]
      : "Loaded issues in the selected group";
    header.actions = d.views.saved.modified(work.query, work.board)
      ? [{ label: "Save changes", target: action("view-save") }]
      : [];
    header.filters.push({ label: `${BREAKDOWN_NAMES[d.views.active.breakdown]} ▾`, target: action("view-breakdown") });
    if (!d.views.chart) header.actions.unshift({ label: "← Chart", target: action("view-back") });
    return header;
  }
  if (pageOf(view).to === View.Team && work.sprint()) {
    header.actions.unshift({ label: "Sprint brief", target: action("brief") });
  }
  header.tabs = pageOf(view).tabs.map(([tab, label]) => ({
    label,
    target: { kind: "view", view: tab },
    tab: tab === view ? "selected" : "unselected",
  }));
  return header;
}

export function pageHeader(d: Dashboard): PageHeader {
  return d.agent.tab ? agentHeader(d) : issuesHeader(d);
}

export function drawHeader(canvas: Canvas, header: PageHeader, rows: ReturnType<typeof headerRows>): void {
  const { width } = canvas;
  if (compactLayout(width)) {
    canvas.put(rows.description, 2, header.description, "muted", width - 4);
    buttons(
      canvas,
      rows.toolbar - 1,
      2,
      header.tabs.map((tab) => ({
        ...tab,
        label: tab.label === "All issues" ? "All" : tab.label === "Needs attention" ? "Attention" : tab.label,
      })),
      width - 2,
    );
    const actions = header.actions.length > 1 ? [{ label: "More ▾", target: action("commands") }] : header.actions;
    const right = buttonsRight(canvas, rows.toolbar, width - 2, actions) - 1;
    buttons(
      canvas,
      rows.toolbar,
      2,
      header.filters.filter((control) => control.target),
      right,
    );
    return;
  }
  canvas.put(rows.description, 2, header.description, "muted", width - 4);
  const right = header.actions.length ? buttonsRight(canvas, rows.toolbar, width - 2, header.actions) - 2 : width - 2;
  const tabsAbove =
    header.tabs.length > 0 && 2 + controlsWidth(header.tabs) + 3 + controlsWidth(header.filters.slice(0, 1)) > right;
  const afterTabs = buttons(
    canvas,
    tabsAbove ? rows.toolbar - 1 : rows.toolbar,
    2,
    header.tabs,
    tabsAbove ? width - 2 : right,
  );
  buttons(canvas, rows.toolbar, header.tabs.length && !tabsAbove ? afterTabs + 2 : 2, header.filters, right);
}
