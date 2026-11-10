/** Draw one full screen of the dashboard onto a Canvas. */

import { usDateTime, usTime } from "../dates";
import { textBlock } from "../jira/adf";
import { MENTION_DAYS, PAGE, VIEW_LABELS, VIEW_SHORT_LABELS, VIEWS, View } from "../jira/query";
import { YOURS } from "../jira/today";
import { describeAttachment, type Issue } from "../jira/types";
import { cells } from "../text";
import { Canvas, type Style } from "./canvas";
import type { Dashboard } from "./dashboard";
import { layout, layoutCached } from "./document";
import { BODY_TOP, BOX_ROWS, LIST_TOP, listRows, MIN_HEIGHT, MIN_WIDTH, modalRows, pickerRows } from "./layout";
import type { Panel } from "./panel";
import type { Picker } from "./picker";
import { currentImage, type Preview } from "./preview";
import { priorityMark, statusGlyph, statusLabel, statusStyle } from "./status";

export function frame(d: Dashboard, width: number, height: number): Canvas {
  const canvas = new Canvas(width, height);
  if (height < MIN_HEIGHT || width < MIN_WIDTH) {
    canvas.put(1, 1, `productboard · make this pane at least ${MIN_WIDTH} × ${MIN_HEIGHT}`, "warning");
    canvas.put(3, 1, "q quit", "text");
    return canvas;
  }
  const work = d.workspace;
  const line = (y: number) => canvas.put(y, 2, "─".repeat(Math.max(0, width - 4)), "muted");

  const title = "◆ productboard";
  canvas.put(1, 2, title, "title");
  const tabGap = width >= 80 ? 3 : 1;
  let x = 2 + cells(title) + Math.min(tabGap, 2);
  const labels = width >= 100 ? VIEW_LABELS : VIEW_SHORT_LABELS;
  for (const [n, view] of VIEWS.entries()) {
    const text = `${n + 1} ${labels[view]}`;
    canvas.put(1, x, text, view === work.query.view ? "accentBold" : "muted");
    canvas.mark(1, x, text.length, { kind: "view", view });
    x += text.length + tabGap;
  }
  line(2);
  canvas.put(3, 2, `${work.scope()} · ${d.personScope()}`, "muted");
  canvas.put(4, 2, `b board   s sprint   p project   a person   d status   g group: ${d.grouping}`, "muted");

  const layer = d.layer();
  if (layer.kind === "preview") drawPreview(canvas, layer.preview, height, line);
  else if (layer.kind === "picker") drawPicker(canvas, d, layer.picker, width, height, line);
  else if (layer.kind === "modal") drawModal(canvas, layer.panel, width, height, line);
  else drawList(canvas, d, width, height, line);
  return canvas;
}

function drawPicker(
  canvas: Canvas,
  d: Dashboard,
  picker: Picker,
  width: number,
  height: number,
  line: (y: number) => void,
): void {
  canvas.put(6, 2, picker.title, "title");
  canvas.put(7, 2, `/ ${picker.query}▏`, "accent");
  const choices = picker.visible();
  const available = pickerRows(height);
  picker.index = Math.max(0, Math.min(picker.index, choices.length - 1));
  picker.offset = Math.min(picker.offset, picker.index);
  if (picker.index >= picker.offset + available) picker.offset = picker.index - available + 1;
  choices.slice(picker.offset, picker.offset + available).forEach((choice, i) => {
    const active = i + picker.offset === picker.index;
    const y = BODY_TOP + i * 2;
    const target = { kind: "choice", index: i + picker.offset } as const;
    canvas.mark(y, 2, width - 4, target);
    canvas.mark(y + 1, 2, width - 4, target);
    if (active) canvas.put(y, 2, " ".repeat(width - 4), "selection");
    canvas.put(y, 2, `${active ? "› " : "  "}${choice.label}`, active ? "selectedBold" : "text");
    canvas.put(y + 1, 4, choice.detail, "muted");
  });
  if (choices.length === 0) {
    const work = d.workspace;
    const busy = work.catalogPending || work.sprintsPending;
    const text = work.catalogError || (busy ? "Loading…" : "No matches");
    canvas.put(BODY_TOP, 2, text.replaceAll("\n", " · "), "warning");
  }
  line(height - 4);
  let footer = "↑↓ select   type to filter   Enter choose   Esc back";
  if (picker.tabs.length) footer = `Tab: ${picker.tabName} ${picker.kind}s   ${footer}`;
  canvas.put(height - 3, 2, footer, "muted");
  const noun = choices.length === 1 ? "choice" : "choices";
  canvas.put(height - 2, 2, `${choices.length} ${noun} · r retry after Esc`, "muted");
}

function drawList(canvas: Canvas, d: Dashboard, width: number, height: number, line: (y: number) => void): void {
  const work = d.workspace;
  const selected = d.selected();
  const box = d.searchBox();
  if (box) {
    // Like a picker's filter line: what is searched, then the words.
    const prefix = `${box.kind === "jira" ? "Search Jira" : "Filter loaded"}  / `;
    canvas.put(LIST_TOP, 2, prefix, "title");
    const text = `${box.text}${box.editing ? "▏" : ""}`;
    canvas.put(LIST_TOP, 2 + prefix.length, text, box.editing ? "accent" : "text");
    if (!box.editing) {
      const keys = box.kind === "jira" ? "f edit · Esc clear" : "/ edit · Esc clear";
      canvas.put(LIST_TOP, 2 + prefix.length + cells(text) + 3, keys, "muted");
    }
    canvas.mark(LIST_TOP, 2, width - 4, { kind: "box" });
  }
  const top = box ? LIST_TOP + BOX_ROWS : LIST_TOP;
  type Row = { issue: Issue } | { text: string; style: Style };
  const rows: Row[] = [];
  for (const [label, issues, heading] of d.groups()) {
    rows.push({ text: `${label}  ${issues.length}`, style: heading });
    for (const issue of issues) rows.push({ issue });
    rows.push({ text: "", style: "muted" });
  }
  if (rows.length === 0) {
    let text = d.search ? "No matching issues" : "No issues in this scope";
    if (work.query.view === View.Sprint && work.query.sprint === null) {
      text = "Press s to choose a sprint, or 2 for everyone's tasks";
    } else if (work.query.view === View.Search && !work.query.text) {
      text =
        d.finding === null ? "Press f to search all of Jira" : "Type words or an issue key above, then press Enter";
    } else if (!work.current && work.pending) {
      text = work.query.view === View.Mentions ? "Looking for mentions…" : "Loading tasks…";
    } else if (work.error) {
      text = "Could not load tasks · r retry";
    }
    rows.push({ text, style: "mutedBold" });
  }
  const available = listRows(height, box !== null);
  const selectedRow = Math.max(
    0,
    rows.findIndex((row) => "issue" in row && row.issue.key === selected?.key),
  );
  if (selectedRow < d.offset) d.offset = Math.max(0, selectedRow - 1);
  if (selectedRow >= d.offset + available) d.offset = selectedRow - available + 1;
  d.offset = Math.min(d.offset, Math.max(0, rows.length - available));
  const shownRows = rows.slice(d.offset, d.offset + available);
  const shownIssues = shownRows.flatMap((row) => ("issue" in row ? [row.issue] : []));
  const columns = rowColumns(d, shownIssues, width);
  shownRows.forEach((row, i) => {
    const y = top + i;
    if (!("issue" in row)) {
      canvas.put(y, 4, row.text, row.style);
      return;
    }
    const { issue } = row;
    canvas.mark(y, 2, width - 4, { kind: "issue", key: issue.key });
    const active = issue.key === selected?.key;
    const style: Style = active ? "selectedBold" : "text";
    const quiet: Style = active ? "selection" : "muted";
    if (active) canvas.put(y, 2, " ".repeat(width - 4), "selection");
    canvas.put(y, 2, active ? "›" : " ", style);
    const [mark, markStyle] = priorityMark(issue.priority);
    canvas.put(y, 4, mark, active ? "selection" : markStyle);
    canvas.put(y, 6, issue.key, quiet, columns.key);
    const glyphX = 6 + columns.key + 2;
    canvas.put(y, glyphX, statusGlyph(issue), active ? "selection" : statusStyle(issue));
    drawSummary(canvas, y, glyphX + 2, issue.summary, columns.title, active);
    let x = glyphX + 2 + columns.title + 2;
    if (columns.reason) {
      canvas.put(y, x, d.note(issue), quiet, columns.reason - 1);
      x += columns.reason;
    }
    if (columns.person) {
      if (issue.section !== YOURS) canvas.put(y, x, issue.assignee, quiet, columns.person - 1);
      x += columns.person;
    }
    if (columns.status) {
      canvas.put(y, x, statusLabel(issue.status), active ? "selection" : statusStyle(issue), columns.status);
    }
  });

  const shown = d.visible().length;
  const snapshot = work.current ? work.snapshot : null;
  let count = `${shown} shown / ${work.issues.length} loaded`;
  if (work.query.view === View.Mentions && snapshot) {
    count = `${shown} shown · read ${snapshot.scanned} issues updated in ${MENTION_DAYS} days`;
  }
  if (work.more) count += ` · n load ${PAGE} more`;
  canvas.put(height - 9, 2, count, "muted");
  line(height - 8);
  if (selected) {
    canvas.put(height - 7, 2, selected.summary, "title");
    const { mention } = selected;
    if (mention) {
      const said = mention.text.split(/\s+/).join(" ");
      canvas.put(height - 6, 2, `${mention.author} · ${usDateTime(mention.created)} · ${said}`, "warning");
    } else {
      const meta = [
        selected.key,
        statusLabel(selected.status),
        selected.assignee,
        selected.priority,
        selected.reason,
      ].filter(Boolean);
      canvas.put(height - 6, 2, meta.join(" · "), "muted");
    }
  }
  drawStatus(canvas, d, height - 5);
  let hint = "↑↓ select   Enter details   / filter   f search Jira";
  if (d.finding !== null) hint = "Type words or an issue key   Enter search   Esc cancel";
  else if (d.searching) hint = "Type to filter loaded issues   Enter keep   Esc done";
  else if (d.search) hint = "↑↓ select   Enter details   / edit filter   Esc clear";
  canvas.put(height - 3, 2, hint, "muted");
  canvas.put(height - 2, 2, "1–7 views   o open   y copy   r refresh   ? help   q quit", "muted");
}

/** Column widths for issue rows. The title takes what is left; side columns
 * drop away on narrow panes, least useful first, and a column repeating what
 * the headings or view already say is left out. */
function rowColumns(d: Dashboard, issues: Issue[], width: number) {
  const key = Math.max(7, ...issues.map((issue) => cells(issue.key)));
  const view = d.workspace.query.view;
  // Status headings already name each row's status.
  const statusHeadings = d.grouping === "status" && view !== View.Today && view !== View.Mentions;
  const wanted = {
    status: statusHeadings ? 0 : Math.min(18, Math.max(...issues.map((i) => cells(statusLabel(i.status))), 0) + 1),
    reason: Math.min(30, Math.max(0, ...issues.map((issue) => cells(d.note(issue)) + 2))),
    // Assigned is all yours; assignee grouping puts names in the headings.
    person: view === View.Mine || d.grouping === "assignee" ? 0 : 18,
  };
  const fixed = 6 + key + 2 + 2 + 2;
  const room = (c: typeof wanted) => width - 2 - fixed - c.status - c.reason - c.person;
  const MIN_TITLE = 36;
  // The status icon still shows the stage once the status text is gone.
  for (const drop of ["person", "status", "reason"] as const) if (room(wanted) < MIN_TITLE) wanted[drop] = 0;
  return { key, ...wanted, title: Math.max(10, room(wanted)) };
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

function drawStatus(canvas: Canvas, d: Dashboard, y: number): void {
  const work = d.workspace;
  if (work.error || work.catalogError) {
    // Only a failed task refresh means the list shown is the previous one.
    const keeping = work.error && work.current ? "Refresh failed · keeping previous list · " : "";
    const text = (work.error || work.catalogError).replaceAll("\n", " · ");
    canvas.put(y, 2, `${keeping}${text} · r retry`, "error");
  } else if (work.pending) {
    canvas.put(y, 2, work.current ? "Refreshing…" : "Loading Jira tasks…", "warning");
  } else if (d.notice) {
    canvas.put(y, 2, d.notice, "accent");
  } else if (work.updated && work.current) {
    const time = usTime(work.updated);
    canvas.put(y, 2, `Updated ${time} · ${d.site} · refreshes every 60s`, "muted");
  } else if (work.catalogPending || work.sprintsPending) {
    canvas.put(y, 2, "Loading boards and sprints…", "warning");
  }
}

function drawModal(canvas: Canvas, panel: Panel, width: number, height: number, line: (y: number) => void): void {
  canvas.put(6, 2, panel.title, "title");
  canvas.put(7, 2, panel.subtitle, "accent");
  const textWidth = Math.max(10, width - 5);
  let lines = layoutCached(panel.body, textWidth);
  if (panel.body.length === 0) {
    lines = layout([textBlock(panel.loading ? "Loading details and comments…" : "No details.", "muted")], textWidth);
  }
  if (panel.error)
    lines = [...layout([textBlock(`Could not load details: ${panel.error}`, "error")], textWidth), [], ...lines];
  const size = modalRows(height);
  panel.scroll = Math.max(0, Math.min(panel.scroll, lines.length - size));
  lines.slice(panel.scroll, panel.scroll + size).forEach((runs, i) => {
    let x = 2;
    for (const run of runs) {
      canvas.put(BODY_TOP + i, x, run.text, run.style);
      x += cells(run.text);
    }
  });
  line(height - 4);
  const files = panel.attachments.length ? "   i attachments" : "";
  canvas.put(height - 3, 2, `↑↓ scroll   PgUp/PgDn page   o open${files}   Esc back`, "muted");
  const last = Math.min(lines.length, panel.scroll + size);
  canvas.put(height - 2, 2, `${panel.scroll + 1}–${last} of ${lines.length} lines`, "muted");
}

/** Title and keys around an image; the screen draws the image itself. */
function drawPreview(canvas: Canvas, preview: Preview, height: number, line: (y: number) => void): void {
  const item = currentImage(preview);
  if (!item) return;
  canvas.put(6, 2, item.filename, "title");
  canvas.put(7, 2, `${preview.index + 1} of ${preview.images.length} · ${describeAttachment(item)}`, "accent");
  if (preview.error) canvas.put(BODY_TOP, 2, `Could not load the image: ${preview.error}`, "error");
  else if (!preview.bytes) canvas.put(BODY_TOP, 2, "Loading image…", "warning");
  line(height - 4);
  const flip = preview.images.length > 1 ? "←/→ previous / next   " : "";
  canvas.put(height - 3, 2, `${flip}o open in Helium   Esc back`, "muted");
  canvas.put(height - 2, 2, `Image ${preview.index + 1} of ${preview.images.length}`, "muted");
}
