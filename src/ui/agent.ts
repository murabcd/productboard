/** The Agent page: the conversation and its text box, under the shared header. */

import type { Turn } from "../agent/chat";
import { choiceLabel } from "../agent/models";
import { cells } from "../text";
import type { Canvas, ScannerStyle, Style } from "./canvas";
import type { Dashboard } from "./dashboard";
import { type Line, layout, wrapSpans } from "./document";
import { markdownBlocks } from "./markdown";

/** Rows the text box may grow to before it scrolls inside. */
export const COMPOSER_MAX_ROWS = 6;

/** The conversation and its text box, below the page header. */
export function drawAgent(canvas: Canvas, dashboard: Dashboard, editing: boolean): void {
  const { chat, composerRows } = dashboard.agent;
  const thread = chat.current;
  const { width, height } = canvas;
  const room = Math.min(width - 5, 72);
  const left = Math.floor((width - room) / 2);

  // The text box grows with its text; OpenTUI draws it in the reserved area.
  const rows = Math.max(1, Math.min(COMPOSER_MAX_ROWS, composerRows));
  const status = height - 2;
  const boxBottom = status - 1;
  const boxTop = boxBottom - rows - 1;
  for (let y = boxTop; y <= boxBottom; y++) {
    canvas.paint(y, left, room, "raised");
    canvas.put(y, left, "┃", thread.pending ? "muted" : "accent");
  }
  // A dialog over Agent takes the keys, so the text box steps aside while it is open.
  if (editing) canvas.reserve("composer", { left: left + 2, top: boxTop + 1, width: room - 3, height: rows });

  const bodyTop = 1;
  const available = boxTop - bodyTop - 1;
  if (thread.turns.length) {
    const lines = thread.turns.flatMap((turn) => turnRows(canvas, turn, thread.issues, left, room));
    thread.scroll = Math.min(thread.scroll, Math.max(0, lines.length - available));
    const end = lines.length - thread.scroll;
    lines.slice(Math.max(0, end - available), end).forEach((draw, row) => {
      draw(bodyTop + row);
    });
  } else {
    drawWelcome(canvas, left, room, bodyTop, available);
  }

  if (thread.pending) {
    const started = thread.turns.at(-1)?.started ?? Date.now();
    drawScanner(canvas, status, left + 1, Math.floor((Date.now() - started) / SCANNER_FRAME_MS));
    canvas.put(status, left + 1 + SCANNER_WIDTH + 2, "esc", "text");
    canvas.put(status, left + 1 + SCANNER_WIDTH + 6, "interrupt", "muted");
  } else if (thread.error) {
    canvas.put(status, left + 1, thread.error, "error", room - 1);
  } else if (!chat.configured) {
    canvas.put(status, left + 1, "Set up Agent with board --agent-login", "muted", room - 1);
  }
}

export const SCANNER_FRAME_MS = 40;
/** Width of the answering scanner, in cells. */
const SCANNER_WIDTH = 8;
/** Steps the scanner rests at each end. */
const HOLD_START = 30;
const HOLD_END = 9;
/** The head, the glare behind it, and four fading steps. */
const TRAIL: ScannerStyle[] = ["trail0", "trail1", "trail2", "trail3", "trail4", "trail5"];
/** Resting blocks, dimmest to brightest; they fade while the head rests and return as it moves. */
const IDLE: ScannerStyle[] = ["idle0", "idle1", "idle2", "idle3"];

function sweep(frame: number): { head: number; forward: boolean; resting?: [done: number, of: number]; moved: number } {
  const last = SCANNER_WIDTH - 1;
  const f = frame % (SCANNER_WIDTH + HOLD_END + last + HOLD_START);
  if (f < SCANNER_WIDTH) return { head: f, forward: true, moved: f / last };
  if (f < SCANNER_WIDTH + HOLD_END) {
    return { head: last, forward: true, resting: [f - SCANNER_WIDTH, HOLD_END], moved: 1 };
  }
  const back = f - SCANNER_WIDTH - HOLD_END;
  if (back < last) return { head: last - 1 - back, forward: false, moved: back / Math.max(1, last - 1) };
  return { head: 0, forward: false, resting: [back - last, HOLD_START], moved: 1 };
}

/** `frame` counts animation steps since the reply began. */
export function drawScanner(canvas: Canvas, y: number, x: number, frame: number): void {
  const { head, forward, resting, moved } = sweep(frame);
  // Resting blocks dim while the head rests, and brighten again as it moves.
  const fade = resting ? 1 - resting[0] / resting[1] : moved;
  const idle = IDLE[Math.min(IDLE.length - 1, Math.round(fade * (IDLE.length - 1)))] ?? "idle3";
  for (let i = 0; i < SCANNER_WIDTH; i++) {
    // Distance behind the head; while resting, the trail drains into the head.
    const behind = (forward ? head - i : i - head) + (resting?.[0] ?? 0);
    const lit = behind >= 0 ? TRAIL[behind] : undefined;
    canvas.put(y, x + i, lit ? "■" : "⬝", lit ?? idle);
  }
}

/** One row of the conversation, drawn at a given screen row. */
type Row = (y: number) => void;

/** "4.2s", or "1m 12s" past a minute. */
function duration(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function turnRows(canvas: Canvas, turn: Turn, issues: ReadonlyMap<string, unknown>, left: number, room: number): Row[] {
  const rows: Row[] = [];
  const blank: Row = () => {};
  const indent = left + 3;
  const prompt =
    (draw: Row): Row =>
    (y) => {
      canvas.paint(y, left, room, "raised");
      canvas.put(y, left, "┃", "accent");
      draw(y);
    };
  rows.push(prompt(blank));
  for (const line of wrapSpans([{ text: turn.prompt, style: "plain" }], room - 5)) {
    rows.push(prompt((y) => drawLine(canvas, y, indent, line)));
  }
  rows.push(prompt(blank), blank);

  for (const line of layout(markdownBlocks(turn.answer), room - 3)) {
    rows.push((y) => {
      let x = indent;
      for (const { text, style } of line) {
        // Issue keys in plain text link to the issue.
        if (style === "text") drawCitedText(canvas, y, x, text, issues);
        else canvas.put(y, x, text, style);
        x += cells(text);
      }
    });
  }
  if (turn.finished !== undefined) {
    const details = [
      choiceLabel(turn.choice),
      duration(turn.finished - turn.started),
      turn.interrupted ? "interrupted" : "",
    ].filter(Boolean);
    rows.push(blank, (y) => canvas.put(y, indent, details.join(" · "), "muted"));
  }
  rows.push(blank);
  return rows;
}

function drawLine(canvas: Canvas, y: number, x: number, line: Line): void {
  for (const { text, style } of line) {
    canvas.put(y, x, text, style);
    x += cells(text);
  }
}

function drawWelcome(canvas: Canvas, left: number, width: number, top: number, height: number): void {
  const center = (text: string) => left + Math.max(0, Math.floor((width - cells(text)) / 2));
  const welcome = Math.max(top, top + Math.floor((height - 2) / 2));
  const title = "What can I help you with?";
  const subtitle = "Ask about sprint progress, risks, or next steps.";
  const description = cells(subtitle) <= width ? subtitle : "Ask about sprint progress or risks.";
  canvas.put(welcome, center(title), title, "title");
  canvas.put(welcome + 1, center(description), description, "muted", width);
}

function drawCitedText(
  canvas: Canvas,
  row: number,
  x: number,
  text: string,
  issues: ReadonlyMap<string, unknown>,
): void {
  for (const segment of text.split(/\b([A-Z][A-Z0-9_]*-\d+)\b/)) {
    const style: Style = issues.has(segment) ? "link" : "text";
    canvas.put(row, x, segment, style);
    if (style === "link") canvas.mark(row, x, cells(segment), { kind: "agent-cite", key: segment });
    x += cells(segment);
  }
}
