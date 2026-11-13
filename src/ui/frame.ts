import { choiceLabel } from "../agent/models";
import { usTime } from "../dates";
import { textBlock } from "../jira/adf";
import { PAGE, View } from "../jira/query";
import { YOURS } from "../jira/today";
import { describeAttachment, type Issue, shortSprintName } from "../jira/types";
import { cells } from "../text";
import { drawAgent } from "./agent";
import { Canvas, type Style } from "./canvas";
import { action, buttons } from "./controls";
import type { Dashboard, Layer } from "./dashboard";
import { drawComposerMenu, pickerDialog } from "./dialog";
import { layout, layoutCached } from "./document";
import { drawHeader, type PageHeader, pageHeader } from "./header";
import type { Target } from "./input";
import {
  BODY_TOP,
  FOOTER_ROWS,
  headerRows,
  issueListLayout,
  MIN_HEIGHT,
  MIN_WIDTH,
  modalRows,
  peekLayout,
  sidebarWidth,
} from "./layout";
import { currentPage, NAV_GROUPS, NAVIGATION, type NavItem } from "./navigation";
import { detailBlocks, type Panel } from "./panel";
import { drawPeek } from "./peek";
import { filterChips, PICKERS } from "./pickers";
import type { Preview } from "./preview";
import { priorityMark, statusIcon } from "./status";

export function frame(d: Dashboard): Canvas {
  const { width, height } = d;
  const layer = d.layer();
  const canvas = new Canvas(width, height);
  if (layer.kind === "too-small") {
    canvas.put(1, 1, `PRODUCTBOARD · make this pane at least ${MIN_WIDTH} × ${MIN_HEIGHT}`, "warning");
    canvas.put(3, 1, "q quit", "text");
    return canvas;
  }
  const sidebar = sidebarWidth(width);
  const content = new Canvas(width - sidebar, height);
  const header = pageHeader(d);
  drawHeader(content, header, headerRows(width));
  drawWorkspace(content, d, layer);
  canvas.paste(content, sidebar, 0);
  if (sidebar) drawSidebar(canvas, d, sidebar);
  drawTopBar(canvas, d, sidebar, header);
  if (layer.kind === "picker" && !d.composerMenu) {
    const source = PICKERS[layer.picker.kind];
    const { panel, left, top } = pickerDialog(canvas, layer.picker, source.empty?.(d) ?? "No matches");
    canvas.paste(panel, left, top);
  }

  return canvas;
}

const navTarget = (item: NavItem): Target =>
  item.to === "agent" ? { kind: "agent", action: "tab" } : { kind: "view", view: item.to };

function drawTopBar(canvas: Canvas, d: Dashboard, sidebar: number, header: PageHeader): void {
  const { width } = canvas;
  const product = "PRODUCT";
  const board = "BOARD";
  const boardStart = 2 + cells(product);
  canvas.put(0, 2, product, "mutedBold");
  canvas.put(0, boardStart, board, "title");
  const shortcut = " ^K ";
  const right = width - 2 - cells(shortcut);
  canvas.put(0, right, shortcut, "muted");
  canvas.mark(0, right, cells(shortcut), action("commands"));
  const titleStart = sidebar ? sidebar + 2 : boardStart + cells(board) + 3;
  canvas.put(0, titleStart, header.title, "title", right - 2 - titleStart);
  if (sidebar) return;

  const here = currentPage(d.workspace.query.view, d.agent.tab);
  buttons(
    canvas,
    1,
    2,
    NAVIGATION.map((item) => ({
      label: item.short,
      target: navTarget(item),
      tab: item === here ? "selected" : "unselected",
    })),
    width - 2,
  );
}

function drawSidebar(canvas: Canvas, d: Dashboard, width: number): void {
  for (let y = 1; y < canvas.height; y++) canvas.put(y, width - 1, "│", "line");
  const here = currentPage(d.workspace.query.view, d.agent.tab);
  const iconColumn = 2;
  const iconWidth = 2;
  const labelColumn = iconColumn + iconWidth + 1;
  let row = 2;
  for (const group of NAV_GROUPS) {
    for (const item of group) {
      const active = item === here;
      if (active) canvas.paint(row, 1, width - 3, "selected");
      canvas.put(row, iconColumn, item.icon, active ? "accentBold" : "mutedBold", iconWidth);
      canvas.put(row, labelColumn, item.name, active ? "accentBold" : "muted", width - labelColumn - 2);
      canvas.mark(row, 1, width - 3, navTarget(item));
      row += 1;
    }
    row += 1;
  }
}

function drawWorkspace(canvas: Canvas, d: Dashboard, layer: Layer): void {
  if (layer.kind === "preview") {
    drawPreview(canvas, d, layer.preview);
    return;
  }
  if (d.modal) {
    drawModal(canvas, d, d.modal);
    return;
  }
  if (layer.kind === "agent" || (d.agent.tab && layer.kind === "picker")) {
    const layout = d.agentLayout;
    const menu = d.composerMenu;
    drawAgent(canvas, d.agent, layout, layer.kind === "agent" || !!menu);
    if (menu) {
      const status = menu === d.contextMenu ? d.contextPicker.status : "";
      const empty = menu.selected ? "" : (PICKERS[menu.kind].empty?.(d) ?? "No matches");
      drawComposerMenu(canvas, layout, menu, d.composerMenuCapacity, status || empty);
    }
    drawAgentFooter(canvas, d);
    return;
  }
  drawList(canvas, d);
}

type Hint = [key: string, label: string, target?: Target];

function drawAgentFooter(canvas: Canvas, d: Dashboard): void {
  const { current } = d.agent;
  const hints: Hint[] = [
    ["⇧↵", "New line"],
    ["^N", "New chat", { kind: "agent", action: "new" }],
  ];
  const label = d.notice || (current ? choiceLabel(current) : "Agent is not set up");
  drawFooter(canvas, d, label, hints, ["", "muted"]);
}

function drawFooter(
  canvas: Canvas,
  d: Dashboard,
  count: string,
  hints: Hint[],
  [status, style]: [string, Style] = statusText(d),
): void {
  const { width, height } = canvas;
  const y = height - 1;
  const size = (list: Hint[]) =>
    list.reduce((sum, [key, label]) => sum + cells(key) + (label ? cells(label) + 1 : 0) + 3, -3);
  // Drop hints from the left of the list when the pane is too narrow.
  let shown = hints;
  while (shown.length && size(shown) > width - 4 - cells(count) - 3) shown = shown.slice(1);
  const room = width - 4 - (shown.length ? size(shown) + 3 : 0);
  canvas.put(y, 2, count, "muted", room);
  if (status && cells(count) + 5 < room) canvas.put(y, 2 + cells(count) + 3, status, style, room - cells(count) - 3);
  let x = width - 2 - size(shown);
  for (const [key, label, target] of shown) {
    canvas.put(y, x, key, "text");
    if (label) canvas.put(y, x + cells(key) + 1, label, "muted");
    const span = cells(key) + (label ? cells(label) + 1 : 0);
    if (target) canvas.mark(y, x, span, target);
    x += span + 3;
  }
}

function drawList(canvas: Canvas, d: Dashboard): void {
  const { height } = canvas;
  const work = d.workspace;
  const peek = d.peek;
  const drawer = peekLayout(canvas.width);
  const width = peek ? drawer.left : canvas.width;
  const box = d.searchBox();
  const { input, status, top } = issueListLayout(d.width, box?.kind);
  if (box) {
    canvas.search(input, 2, width - 4, box, box.editing);
    canvas.mark(input, 2, width - 4, { kind: "box" });
  }
  const { rows: shownRows, selected, count: shown, listed } = d.list.window(d.listCapacity());
  if (!shownRows.length) canvas.put(status, 4, emptyText(d), "mutedBold", width - 6);
  const shownIssues = shownRows.flatMap((row) => ("issue" in row ? [row.issue] : []));
  // Sized from the whole list, not the rows on screen, so columns hold still while scrolling.
  const columns = rowColumns(d, listed, width);
  // Rows carry a status icon unless status headings already show it.
  const icons = !(d.list.grouping === "status" && work.query.view !== View.Today && work.query.view !== View.Mentions);

  if (shownIssues.length) {
    const y = top - 1;
    let x = columns.right;
    canvas.put(y, columns.title, "Issue", "muted");
    for (const [name, size] of [
      ["Activity", columns.reason],
      ["Assignee", columns.person],
      ["Sprint", columns.sprint],
    ] as const) {
      if (size) canvas.put(y, x, name, "muted", size - 1);
      x += size;
    }
    canvas.put(y, x, "Pri", "muted");
  }

  shownRows.forEach((row, i) => {
    const y = top + i;
    if (!("issue" in row)) {
      const { label, count, icon, style, folded } = row;
      const room = width - 14;
      canvas.paint(y, 1, width - 2, "raised");
      canvas.put(y, 2, icon, style);
      canvas.put(y, 4, label, "accentBold", room);
      canvas.put(y, 5 + Math.min(cells(label), room), `${count} ${folded ? "▸" : "▾"}`, "muted");
      canvas.mark(y, 1, width - 2, { kind: "group", label });
      return;
    }
    const { issue } = row;
    canvas.mark(y, 1, width - 2, { kind: "issue", key: issue.key });
    const active = issue.key === selected?.key;
    const quiet: Style = active ? "selection" : "muted";
    if (active) {
      canvas.put(y, 1, " ".repeat(width - 2), "selection");
      canvas.put(y, 2, "›", "selectedBold");
    } else if (icons) {
      const [icon, style] = statusIcon(issue);
      canvas.put(y, 2, icon, style);
    }
    canvas.put(y, 4, issue.key, quiet, columns.key);
    drawSummary(canvas, y, columns.title, issue.summary, columns.titleWidth, active);
    let x = columns.right;
    if (columns.reason) canvas.put(y, x, issue.reason ?? "", quiet, columns.reason - 2);
    x += columns.reason;
    if (columns.person && issue.section !== YOURS) canvas.put(y, x, issue.assignee, quiet, columns.person - 2);
    x += columns.person;
    if (columns.sprint) canvas.put(y, x, shortSprintName(issue.sprint), quiet, columns.sprint - 2);
    x += columns.sprint;
    const [mark, markStyle] = priorityMark(issue.priority);
    canvas.put(y, x, mark, active ? "selection" : markStyle);
  });

  if (peek) canvas.paste(drawPeek(peek, drawer.width, height - top - FOOTER_ROWS), drawer.left, top);

  const total = work.issues.length;
  let count = `${shown} ${shown === 1 ? "issue" : "issues"}`;
  if (shown !== total) count = `${shown} of ${total} issues`;
  if (work.query.view === View.Mentions && work.current) count += ` · read ${work.snapshot?.scanned ?? 0}`;
  let hints: Hint[] = [["?", "Shortcuts", action("help")]];
  if (d.peekFits()) hints.unshift(["Space", d.peekOpen ? "Close peek" : "Peek", action("peek")]);
  if (peek) hints.unshift(["⇧↑↓", "Scroll peek"]);
  if (work.more) hints.unshift(["n", `Load ${PAGE} more`, action("load-more")]);
  if (box?.editing) hints = [];
  drawFooter(canvas, d, count, hints);
}

function emptyText(d: Dashboard): string {
  const work = d.workspace;
  if (work.query.view === View.Search && !work.query.text) return "";
  if (!work.current && work.pending)
    return work.query.view === View.Mentions ? "Looking for mentions…" : "Loading issues…";
  if (work.error) return "Could not load issues · r retry";
  return d.list.search || filterChips(d).length
    ? "No issues match this view. Clear a filter or change the search."
    : "No issues in this view";
}

/** Column positions for issue rows. The title takes what is left; side
 * columns drop away on narrow panes, least useful first. */
function rowColumns(d: Dashboard, issues: Issue[], width: number) {
  const key = Math.max(7, ...issues.map((issue) => cells(issue.key)));
  const view = d.workspace.query.view;
  // Each column is as wide as its longest value in the list, up to a cap, plus a gap.
  const fit = (cap: number, text: (issue: Issue) => string) =>
    Math.min(cap, Math.max(0, ...issues.map((issue) => cells(text(issue))))) + 2;
  const fitOrNone = (cap: number, text: (issue: Issue) => string) =>
    issues.some((issue) => text(issue)) ? fit(cap, text) : 0;
  const wanted = {
    reason: fitOrNone(26, (i) => i.reason ?? ""),
    // Assigned is all yours; assignee grouping puts names in the headings.
    person: view === View.Mine || d.list.grouping === "assignee" ? 0 : fit(18, (i) => i.assignee),
    sprint: fitOrNone(14, (i) => shortSprintName(i.sprint)),
  };
  const title = 4 + key + 2;
  const PRI = 4;
  const room = (c: typeof wanted) => width - 2 - title - 2 - c.reason - c.person - c.sprint - PRI;
  // Sprint and reason go first; the assignee stays until titles get short.
  const minimum = { sprint: 36, reason: 36, person: 24 } as const;
  for (const drop of ["sprint", "reason", "person"] as const) if (room(wanted) < minimum[drop]) wanted[drop] = 0;
  const titleWidth = Math.max(10, room(wanted));
  return { key, title, titleWidth, right: title + titleWidth + 2, ...wanted };
}

/** Separators that end a breadcrumb prefix such as "Storefront - " or "ЛК / Рассылки - ". */
const CRUMB = /^(.{2,48}?\s[-–—|]\s)/;

/** A summary with its breadcrumb prefix dimmed, so the words that differ stand out. */
function drawSummary(canvas: Canvas, y: number, x: number, summary: string, width: number, active: boolean): void {
  const crumb = CRUMB.exec(summary)?.[1] ?? "";
  const rest = summary.slice(crumb.length);
  if (!crumb || !rest.trim() || cells(crumb) >= width - 8) {
    canvas.put(y, x, summary, active ? "selectedBold" : "text", width);
    return;
  }
  canvas.put(y, x, crumb, active ? "selection" : "muted", width);
  canvas.put(y, x + cells(crumb), rest, active ? "selectedBold" : "text", width - cells(crumb));
}

function statusText(d: Dashboard): [string, Style] {
  const work = d.workspace;
  if (work.error || work.catalogError) {
    // Only a failed refresh means the list shown is the previous one.
    const keeping = work.error && work.current ? "Showing the last list · " : "";
    return [`${keeping}${(work.error || work.catalogError).replaceAll("\n", " · ")} · r retry`, "error"];
  }
  if (d.notice) return [d.notice, "accent"];
  if (work.pending) return [work.current ? "Refreshing…" : "Loading…", "muted"];
  if (work.updated && work.current) return [`Updated ${usTime(work.updated)}`, "muted"];
  return ["", "muted"];
}

function drawModal(canvas: Canvas, d: Dashboard, panel: Panel): void {
  const { width, height } = canvas;
  const textWidth = Math.max(10, width - 5);
  let lines: ReturnType<typeof layout>;
  if (panel.kind === "issue") {
    const { issue } = panel;
    const { state } = panel.read;
    canvas.put(BODY_TOP - 3, 2, "Issue details", "muted");
    canvas.put(BODY_TOP - 2, 2, issue.summary, "title", width - 4);
    canvas.put(BODY_TOP - 1, 2, `${issue.key} · ${issue.status} · ${issue.assignee}`, "accent", width - 4);
    lines = state.data ? layoutCached(detailBlocks(state.data), textWidth) : [];
    if (state.kind === "loading" && !state.data)
      lines = layout([textBlock("Loading details and comments…", "muted")], textWidth);
    if (state.kind === "error")
      lines = [...layout([textBlock(`Could not load details: ${state.message}`, "error")], textWidth), [], ...lines];
  } else {
    canvas.put(BODY_TOP - 3, 2, panel.title, "title", width - 4);
    lines = layoutCached(panel.body, textWidth);
  }
  const size = modalRows(height);
  panel.scroll = Math.max(0, Math.min(panel.scroll, lines.length - size));
  lines.slice(panel.scroll, panel.scroll + size).forEach((runs, i) => {
    let x = 2;
    for (const run of runs) {
      canvas.put(BODY_TOP + i, x, run.text, run.style);
      x += cells(run.text);
    }
  });
  const last = Math.min(lines.length, panel.scroll + size);
  const hints: Hint[] = [];
  const attachments = d.attachments.length;
  if (attachments) hints.push(["i", `${attachments} attachments`]);
  if (panel.kind === "issue") hints.push(["o", "Open in Jira"], ["y", "Copy link"]);
  const position = lines.length > size ? `${Math.round((last / lines.length) * 100)}%` : "";
  drawFooter(canvas, d, position, hints);
}

function drawPreview(canvas: Canvas, d: Dashboard, preview: Preview): void {
  const {
    image: item,
    read: { state },
  } = preview;
  canvas.put(BODY_TOP - 3, 2, item.filename, "title");
  canvas.put(
    BODY_TOP - 2,
    2,
    `${preview.index + 1} of ${preview.images.length} · ${describeAttachment(item)}`,
    "accent",
  );
  if (state.kind === "error") canvas.put(BODY_TOP, 2, `Could not load the image: ${state.message}`, "error");
  else if (state.kind === "loading") canvas.put(BODY_TOP, 2, "Loading image…", "warning");
  // OpenTUI draws the image itself, with the best protocol the terminal has.
  else {
    const height = modalRows(canvas.height);
    canvas.reserve("image", {
      left: 2,
      top: BODY_TOP,
      width: Math.max(1, canvas.width - 4),
      height: Math.max(1, height),
    });
  }
  const hints: Hint[] = [];
  if (preview.images.length > 1) hints.push(["←→", "Previous / next"]);
  hints.push(["o", "Open in Helium"]);
  drawFooter(canvas, d, `Image ${preview.index + 1} of ${preview.images.length}`, hints);
}
