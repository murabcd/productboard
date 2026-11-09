/** Draw one full screen of the dashboard onto a Canvas. */

import { MENTION_DAYS, PAGE, VIEW_LABELS, VIEW_SHORT_LABELS, VIEWS, View } from "../jira/query";
import { describeAttachment, type Issue } from "../jira/types";
import { textBlock } from "../jira/adf";
import { cells } from "../text";
import { Canvas, type Style } from "./canvas";
import type { Dashboard } from "./dashboard";
import { BODY_TOP, BOX_ROWS, LIST_TOP, listRows, MIN_HEIGHT, MIN_WIDTH, modalRows, pickerRows } from "./layout";
import { layout, layoutCached } from "./document";
import type { Panel } from "./panel";
import type { Picker } from "./picker";
import { currentImage, type Preview } from "./preview";

export function frame(d: Dashboard, width: number, height: number): Canvas {
  const canvas = new Canvas(width, height);
  if (height < MIN_HEIGHT || width < MIN_WIDTH) {
    canvas.put(1, 1, `Jira · make this pane at least ${MIN_WIDTH} × ${MIN_HEIGHT}`, "warning");
    canvas.put(3, 1, "q quit", "text");
    return canvas;
  }
  const work = d.workspace;
  const line = (y: number) => canvas.put(y, 2, "─".repeat(Math.max(0, width - 4)), "muted");

  canvas.put(1, 2, "◆ jira", "title");
  let x = 12;
  const labels = width >= 96 ? VIEW_LABELS : VIEW_SHORT_LABELS;
  for (const [n, view] of VIEWS.entries()) {
    const text = `${n + 1} ${labels[view]}`;
    canvas.put(1, x, text, view === work.query.view ? "accentBold" : "muted");
    canvas.mark(1, x, text.length, { kind: "view", view });
    x += text.length + 3;
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

function drawList(
  canvas: Canvas,
  d: Dashboard,
  width: number,
  height: number,
  line: (y: number) => void,
): void {
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
  const rows: [string, Issue | null][] = [];
  for (const [label, issues] of d.groups()) {
    rows.push([`${label}  ${issues.length}`, null]);
    for (const issue of issues) rows.push(["", issue]);
    rows.push(["", null]);
  }
  if (rows.length === 0) {
    let text = d.search ? "No matching issues" : "No issues in this scope";
    if (work.query.view === View.Sprint && work.query.sprint === null) {
      text = "Press s to choose a sprint, or 2 for everyone's tasks";
    } else if (work.query.view === View.Search && !work.query.text) {
      text = d.finding === null ? "Press f to search all of Jira" : "Type words or an issue key above, then press Enter";
    } else if (!work.current && work.pending) {
      text = work.query.view === View.Mentions ? "Looking for mentions…" : "Loading tasks…";
    } else if (work.error) {
      text = "Could not load tasks · r retry";
    }
    rows.push([text, null]);
  }
  const available = listRows(height, box !== null);
  const selectedRow = Math.max(
    0,
    rows.findIndex(([, issue]) => issue && selected && issue.key === selected.key),
  );
  if (selectedRow < d.offset) d.offset = Math.max(0, selectedRow - 1);
  if (selectedRow >= d.offset + available) d.offset = selectedRow - available + 1;
  d.offset = Math.min(d.offset, Math.max(0, rows.length - available));
  // Narrow panes drop the person and status columns.
  const statusWidth = width >= 115 ? 23 : width >= 75 && d.grouping === "assignee" ? 18 : 0;
  const personWidth = width >= 115 ? 22 : width >= 75 && d.grouping !== "assignee" ? 18 : 0;
  rows.slice(d.offset, d.offset + available).forEach(([label, issue], i) => {
    const y = top + i;
    if (!issue) {
      canvas.put(y, 4, label, "mutedBold");
      return;
    }
    canvas.mark(y, 2, width - 4, { kind: "issue", key: issue.key });
    const active = issue.key === selected?.key;
    const style: Style = active ? "selectedBold" : "text";
    if (active) canvas.put(y, 2, " ".repeat(width - 4), "selection");
    canvas.put(y, 2, active ? "›" : " ", style);
    canvas.put(y, 4, issue.key, style, 12);
    canvas.put(y, 18, issue.summary, style, width - 21 - statusWidth - personWidth);
    if (personWidth) {
      canvas.put(y, width - personWidth - statusWidth - 2, d.note(issue), active ? "selection" : "muted", personWidth - 1);
    }
    if (statusWidth) {
      const statusStyle: Style = active ? "selection" : issue.category === "done" ? "done" : "muted";
      canvas.put(y, width - statusWidth - 2, issue.status, statusStyle, statusWidth);
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
      canvas.put(height - 6, 2, `${mention.author} · ${mention.created} · ${said}`, "warning");
    } else {
      const meta = [selected.key, selected.status, selected.assignee, selected.priority, selected.reason].filter(Boolean);
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
    const time = work.updated.toTimeString().slice(0, 8);
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
  if (panel.error) lines = [...layout([textBlock(`Could not load details: ${panel.error}`, "error")], textWidth), [], ...lines];
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
