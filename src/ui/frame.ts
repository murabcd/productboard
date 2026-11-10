import { choiceLabel } from "../agent/models";
import { usTime } from "../dates";
import { textBlock } from "../jira/adf";
import { PAGE, View } from "../jira/query";
import { YOURS } from "../jira/today";
import { describeAttachment, type Issue, shortSprintName } from "../jira/types";
import { cells } from "../text";
import { drawAgent } from "./agent";
import { Canvas, type Style } from "./canvas";
import { action, buttonsRight } from "./controls";
import type { Dashboard, Layer } from "./dashboard";
import { drawDialog } from "./dialog";
import { layout, layoutCached } from "./document";
import { drawHeader } from "./header";
import type { Target } from "./input";
import {
  BODY_TOP,
  BOX_ROWS,
  FOOTER_ROWS,
  LIST_TOP,
  MIN_HEIGHT,
  MIN_WIDTH,
  modalRows,
  peekWidth,
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
    canvas.put(1, 1, `productboard · make this pane at least ${MIN_WIDTH} × ${MIN_HEIGHT}`, "warning");
    canvas.put(3, 1, "q quit", "text");
    return canvas;
  }
  const sidebar = sidebarWidth(width);
  const content = new Canvas(width - sidebar, height);
  drawWorkspace(content, d, layer);
  canvas.paste(content, sidebar, 0);
  if (sidebar) drawSidebar(canvas, d, sidebar);
  drawTopBar(canvas, d, sidebar);
  if (layer.kind === "picker") drawDialog(canvas, layer.picker, PICKERS[layer.picker.kind].empty?.(d) ?? "No matches");

  return canvas;
}

const navTarget = (item: NavItem): Target =>
  item.to === "agent" ? { kind: "agent", action: "tab" } : { kind: "view", view: item.to };

function drawTopBar(canvas: Canvas, d: Dashboard, sidebar: number): void {
  const { width } = canvas;
  canvas.paint(0, 0, width, "chrome");
  canvas.put(0, 2, "◆", "accent");
  // The narrowest panes keep only the mark, so every page tab still fits.
  const compact = !sidebar && width < 80;
  if (!compact) canvas.put(0, 4, "productboard", "title");
  const right = buttonsRight(canvas, 0, width - 2, [{ label: "^K", target: action("commands"), style: "accent" }]);
  if (sidebar) return;
  // Narrow panes: pages sit in the top bar, the current one highlighted.
  const here = currentPage(d.workspace.query.view, d.agent.tab);
  let x = compact ? 4 : 18;
  for (const item of NAVIGATION) {
    const label = ` ${item.short} `;
    if (x + cells(label) > right - 1) break;
    const active = item === here;
    canvas.put(0, x, label, active ? "accentBold" : "muted");
    if (active) canvas.paint(0, x, cells(label), "selected");
    canvas.mark(0, x, cells(label), navTarget(item));
    x += cells(label) + (compact ? 0 : 1);
  }
}

function drawSidebar(canvas: Canvas, d: Dashboard, width: number): void {
  for (let y = 1; y < canvas.height; y++) canvas.put(y, width - 1, "│", "line");
  const here = currentPage(d.workspace.query.view, d.agent.tab);
  let row = 2;
  for (const group of NAV_GROUPS) {
    for (const item of group) {
      const active = item === here;
      if (active) canvas.paint(row, 1, width - 3, "selected");
      canvas.put(row, 2, `${item.icon} ${item.name}`, active ? "accentBold" : "muted", width - 4);
      canvas.mark(row, 1, width - 3, navTarget(item));
      row += 1;
    }
    row += 1;
  }
}

function drawWorkspace(canvas: Canvas, d: Dashboard, layer: Layer): void {
  const { width, height } = canvas;
  drawHeader(canvas, d);
  // A picker opens as a dialog over the page, so the page stays drawn under it.
  if (layer.kind === "agent" || (d.agent.tab && layer.kind === "picker")) {
    // Under the shared header, where the list would start, and above the footer.
    const body = new Canvas(width, height - (LIST_TOP - 1) - FOOTER_ROWS);
    drawAgent(body, d, layer.kind === "agent");
    canvas.paste(body, 0, LIST_TOP - 1);
    drawAgentFooter(canvas, d);
    return;
  }
  if (layer.kind === "preview") drawPreview(canvas, d, layer.preview);
  else if (layer.kind === "modal") drawModal(canvas, d, layer.panel);
  else drawList(canvas, d);
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
  canvas.paint(y, 0, width, "chrome");
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
  const width = peek ? canvas.width - peekWidth(canvas.width) : canvas.width;
  const box = d.searchBox();
  if (box) {
    const y = LIST_TOP - 1;
    const prefix = `${box.kind === "jira" ? "Search Jira" : "Filter loaded"}  / `;
    canvas.put(y, 2, prefix, "title");
    const text = `${box.text}${box.editing ? "▏" : ""}`;
    canvas.put(y, 2 + prefix.length, text, box.editing ? "accent" : "text");
    canvas.mark(y, 2, width - 4, { kind: "box" });
  }
  const top = box ? LIST_TOP + BOX_ROWS : LIST_TOP;
  const { rows: shownRows, selected, count: shown, listed } = d.list.window(d.listCapacity());
  if (!shownRows.length) canvas.put(top, 4, emptyText(d), "mutedBold", width - 6);
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

  if (peek) drawPeek(canvas, peek, width, top - 1, canvas.width - width, height - 1);

  const total = work.issues.length;
  let count = `${shown} ${shown === 1 ? "issue" : "issues"}`;
  if (shown !== total) count = `${shown} of ${total} issues`;
  if (work.query.view === View.Mentions && work.current) count += ` · read ${work.snapshot?.scanned ?? 0}`;
  let hints: Hint[] = [["?", "Shortcuts", action("help")]];
  if (d.peekFits()) hints.unshift(["Space", d.peekOpen ? "Close peek" : "Peek", action("peek")]);
  if (work.more) hints.unshift(["n", `Load ${PAGE} more`, action("load-more")]);
  if (d.finding !== null || d.searching) hints = [];
  drawFooter(canvas, d, count, hints);
}

function emptyText(d: Dashboard): string {
  const work = d.workspace;
  if (work.query.view === View.Sprint && work.query.sprint === null) return "Press s to choose a sprint";
  if (work.query.view === View.Search && !work.query.text) {
    return d.finding === null ? "Press f to search all of Jira" : "Type words or an issue key above, then press Enter";
  }
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
    // Every row of the Sprints view is in the chosen sprint.
    sprint: view === View.Sprint ? 0 : fitOrNone(14, (i) => shortSprintName(i.sprint)),
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
    canvas.put(BODY_TOP - 3, 2, "ISSUE DETAILS", "muted");
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
    const height = canvas.height - BODY_TOP - FOOTER_ROWS - 1;
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
