/** The Agent page: the conversation and its text box, under the shared header. */

import type { Issue } from "../jira/types";
import { cells } from "../text";
import type { AgentPanel } from "./agent-panel";
import type { Canvas, ScannerStyle, Style } from "./canvas";
import type { AgentLayout } from "./layout";
import { transcriptWindow } from "./transcript";

export function drawAgent(canvas: Canvas, { chat }: AgentPanel, layout: AgentLayout, showComposer: boolean): void {
  const thread = chat.current;
  const { left, rows, status, boxBottom, boxTop, transcript } = layout;
  const { room } = transcript;
  for (let y = boxTop; y <= boxBottom; y++) {
    canvas.paint(y, left, room, "raised");
    canvas.put(y, left, "┃", thread.pending ? "muted" : "accent");
  }
  if (showComposer)
    canvas.reserve("composer", { left: left + 2, top: boxBottom - rows, width: room - 3, height: rows });

  if (thread.turns.length) {
    const { rows } = transcriptWindow(thread.turns, transcript, thread.scroll);
    rows.forEach(({ kind, line }, row) => {
      const y = transcript.top + row;
      if (kind === "prompt") {
        canvas.paint(y, left, room, "raised");
        canvas.put(y, left, "┃", "accent");
      }
      let x = left + 3;
      for (const { text, style } of line) {
        if (kind === "answer" && style === "text") drawCitedText(canvas, y, x, text, thread.issues);
        else canvas.put(y, x, text, style);
        x += cells(text);
      }
    });
  } else {
    drawWelcome(canvas, left, room, transcript.top, transcript.capacity);
  }

  if (thread.pending) {
    const started = thread.turns.at(-1)?.started ?? Date.now();
    drawScanner(canvas, status, left + 1, Math.floor((Date.now() - started) / SCANNER_FRAME_MS));
    canvas.put(status, left + 1 + SCANNER_WIDTH + 2, "esc", "text");
    canvas.put(status, left + 1 + SCANNER_WIDTH + 6, "interrupt", "muted");
  } else if (thread.draft.error) {
    canvas.put(status, left + 1, thread.draft.error, "error", room - 1);
  } else if (thread.draft.loading) {
    canvas.put(status, left + 1, "Attaching image…", "muted", room - 1);
  } else if (!chat.configured) {
    canvas.put(status, left + 1, "Ctrl+K · Connect Agent", "muted", room - 1);
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

function drawWelcome(canvas: Canvas, left: number, width: number, top: number, height: number): void {
  const center = (text: string) => left + Math.max(0, Math.floor((width - cells(text)) / 2));
  const welcome = Math.max(top, top + Math.floor((height - 2) / 2));
  const title = "What can I help you with?";
  const description = "Ask about issues across Jira.";
  canvas.put(welcome, center(title), title, "title");
  canvas.put(welcome + 1, center(description), description, "muted", width);
}

/** An issue key such as FL-123, kept as its own piece when a reply is split. */
const ISSUE_KEY = /\b([A-Z][A-Z0-9_]*-\d+)\b/;

function drawCitedText(canvas: Canvas, row: number, x: number, text: string, issues: ReadonlyMap<string, Issue>): void {
  for (const segment of text.split(ISSUE_KEY)) {
    const style: Style = issues.has(segment) ? "link" : "text";
    canvas.put(row, x, segment, style);
    if (style === "link") canvas.mark(row, x, cells(segment), { kind: "agent-cite", key: segment });
    x += cells(segment);
  }
}
