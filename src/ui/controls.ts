/** Buttons: clickable labels on a raised surface, as in the header and top bar. */

import { cells } from "../text";
import type { Canvas, Style } from "./canvas";
import type { Action, Target } from "./input";

export interface Control {
  label: string;
  /** What a click does; a control without one is a label, such as an active filter. */
  target?: Target;
  style?: Style;
  /** A tab rather than a button: plain text, highlighted when selected. */
  tab?: "selected" | "unselected";
}

export const action = (name: Action): Target => ({ kind: "action", action: name });

const width = ({ label }: Control): number => cells(label) + 2;

/** Draw a button or tab at (y, x); returns its width. */
export function button(canvas: Canvas, y: number, x: number, control: Control): number {
  const text = ` ${control.label} `;
  if (control.tab === "selected") {
    canvas.put(y, x, text, "accentBold");
    canvas.paint(y, x, cells(text), "selected");
  } else {
    canvas.put(y, x, text, control.style ?? "muted");
    if (!control.tab) canvas.paint(y, x, cells(text), "raised");
  }
  if (control.target) canvas.mark(y, x, cells(text), control.target);
  return cells(text);
}

/** Controls left to right from x, a cell apart, stopping before `limit`; returns where they end. */
export function buttons(canvas: Canvas, y: number, x: number, controls: Control[], limit = canvas.width): number {
  for (const control of controls) {
    if (x + width(control) > limit) break;
    x += button(canvas, y, x, control) + 1;
  }
  return x;
}

/** Controls right to left, ending at `right`; returns where the first starts. */
export function buttonsRight(canvas: Canvas, y: number, right: number, controls: Control[]): number {
  const start = right - controls.reduce((sum, control) => sum + width(control) + 1, -1);
  buttons(canvas, y, start, controls);
  return start;
}
