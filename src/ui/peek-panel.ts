/** Shared drawer surface, pinned heading, and scroll window for terminal previews. */
import { cells } from "../text";
import type { Canvas } from "./canvas";
import type { Line } from "./document";

export type PeekRow = (y: number) => void;

export function drawPeekPanel(canvas: Canvas, title: string, state: { scroll: number }, rows: PeekRow[]): void {
  const { width, height } = canvas;
  for (let y = 0; y < height; y++) {
    canvas.put(y, 0, "│", "line");
    canvas.mark(y, 0, width, { kind: "peek" });
  }
  canvas.put(0, 2, title, "muted");
  const available = Math.max(0, height - 2);
  state.scroll = Math.max(0, Math.min(state.scroll, rows.length - available));
  rows.slice(state.scroll, state.scroll + available).forEach((row, i) => {
    row(2 + i);
  });
  const above = state.scroll > 0;
  const below = state.scroll + available < rows.length;
  if (above || below)
    canvas.put(0, 3 + cells(title), above && below ? "↑↓ more" : above ? "↑ more" : "↓ more", "accent");
}

export function drawPeekLine(canvas: Canvas, y: number, x: number, line: Line): void {
  let column = x;
  for (const run of line) {
    canvas.put(y, column, run.text, run.style);
    column += cells(run.text);
  }
}
