/** The issue peek beside the list: the selected issue's facts, description
 * and latest comment, without leaving the list. */

import { usDateTime } from "../dates";
import { type DocBlock, textBlock } from "../jira/adf";
import { type Comment, type Issue, issueProject } from "../jira/types";
import { cells } from "../text";
import { Canvas } from "./canvas";
import { type Line, layout, layoutCached } from "./document";
import type { IssueRead } from "./issue-details";
import { priorityMark, statusIcon, statusLabel } from "./status";

export interface Peek {
  issue: Issue;
  read: IssueRead;
  /** Rows scrolled past under the panel's top bar. */
  scroll: number;
}

type Row = (y: number) => void;

/** The top bar stays put while the detail rows scroll. */
export function drawPeek(peek: Peek, width: number, height: number): Canvas {
  const canvas = new Canvas(width, height, "panel");
  for (let y = 0; y < height; y++) {
    canvas.put(y, 0, "│", "line");
    canvas.mark(y, 0, width, { kind: "peek" });
  }
  const left = 2;
  const room = width - 4;
  canvas.put(0, left, "Issue peek", "muted");

  const rows = peekRows(canvas, peek, left, room);
  const available = height - 2;
  peek.scroll = Math.max(0, Math.min(peek.scroll, rows.length - available));
  rows.slice(peek.scroll, peek.scroll + available).forEach((row, i) => {
    row(2 + i);
  });
  const above = peek.scroll > 0;
  const below = peek.scroll + available < rows.length;
  if (above || below) canvas.put(0, left + 12, above && below ? "↑↓ more" : above ? "↑ more" : "↓ more", "accent");
  return canvas;
}

function peekRows(canvas: Canvas, peek: Peek, left: number, room: number): Row[] {
  const rows: Row[] = [];
  const blank: Row = () => {};
  const lines = (list: Line[]) => {
    for (const line of list) rows.push((y) => drawLine(canvas, y, left, line));
  };
  const { issue } = peek;
  const { state } = peek.read;
  const detail = state.data;
  rows.push((y) => canvas.put(y, left, issue.key, "muted"));
  lines(layout([textBlock(issue.summary, "strong")], room));
  rows.push(blank);

  rows.push((y) => {
    const [icon, style] = statusIcon(issue);
    const status = ` ${icon} ${statusLabel(issue.status)} `;
    const statusWidth = Math.min(cells(status), room);
    canvas.put(y, left, status, style, statusWidth);
    canvas.paint(y, left, statusWidth, "raised");
    if (!issue.priority || statusWidth + 1 >= room) return;
    const priority = ` ${priorityMark(issue.priority)[0]} ${issue.priority} `;
    const px = left + statusWidth + 1;
    const fits = Math.min(cells(priority), room - statusWidth - 1);
    canvas.put(y, px, priority, "accent", fits);
    canvas.paint(y, px, fits, "raised");
  });
  rows.push(blank);

  const project = detail?.facts.find((fact) => fact.startsWith("Project: "))?.slice(9) ?? issueProject(issue);
  const facts: [string, string][] = [
    ["Assignee", issue.assignee],
    ["Sprint", issue.sprint || "No sprint"],
    ["Project", project],
  ];
  if (issue.reason) facts.push(["Why", issue.reason]);
  for (const [label, value] of facts) {
    rows.push((y) => {
      canvas.put(y, left, label, "muted");
      canvas.put(y, left + 10, value, "text", room - 10);
    });
  }
  rows.push(blank);

  if (state.kind === "error") lines(layout([textBlock(`Could not load details: ${state.message}`, "error")], room));
  if (!detail) {
    if (state.kind === "loading") rows.push((y) => canvas.put(y, left, "Loading details…", "muted"));
    return rows;
  }
  rows.push((y) => canvas.put(y, left, "Description", "title"));
  const description: DocBlock[] = detail.description.length
    ? detail.description
    : [textBlock("No description.", "muted")];
  lines(layoutCached(description, room));
  // The comment that mentions you, else the newest one.
  const comment = issue.mention ?? detail.comments[0];
  if (comment) {
    rows.push(blank);
    rows.push((y) => canvas.put(y, left, issue.mention ? "Mentioned you" : "Latest comment", "title"));
    lines(commentBlock(comment, room));
  }
  return rows;
}

/** A comment reads as one paragraph in the peek. */
const WHITESPACE = /\s+/;

function commentBlock(comment: Comment, width: number): Line[] {
  const byline = `${comment.author} · ${usDateTime(comment.created)}`;
  const text = comment.text.split(WHITESPACE).join(" ") || "(empty comment)";
  return layout([textBlock(byline, "muted"), textBlock(text, "muted")], width).filter((line) => line.length);
}

function drawLine(canvas: Canvas, y: number, x: number, line: Line): void {
  let column = x;
  for (const run of line) {
    canvas.put(y, column, run.text, run.style);
    column += cells(run.text);
  }
}
