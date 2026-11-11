import { cells } from "../text";
import { Canvas, type Rect } from "./canvas";
import { pickerRows } from "./layout";
import type { Picker } from "./picker";

/** Text starts this far in; choices keep one more cell for the ● mark. */
export const DIALOG_INSET = 3;
const DIALOG_WIDTH = 60;

type Viewport = Pick<Rect, "width" | "height">;
export type DialogFrame = Pick<Rect, "left" | "top"> & { panel: Canvas };

export function dialogPanel(viewport: Viewport, height: number, title: string): DialogFrame {
  const width = Math.min(DIALOG_WIDTH, viewport.width - 2);
  const panel = new Canvas(width, height, "panel");
  for (let y = 0; y < height; y++) panel.mark(y, 0, width, { kind: "dialog" });
  const close = width - DIALOG_INSET - 3;
  panel.put(1, DIALOG_INSET, title, "title", close - DIALOG_INSET - 2);
  panel.put(1, close, "esc", "muted");
  panel.mark(1, close, 3, { kind: "dismiss" });
  return {
    panel,
    left: Math.floor((viewport.width - width) / 2),
    top: Math.min(Math.floor(viewport.height / 4), viewport.height - height - 1),
  };
}

export function pickerDialog(
  viewport: Viewport,
  picker: Picker<string>,
  emptyText: string,
  { status, accentSelection = false }: { status?: string; accentSelection?: boolean } = {},
): DialogFrame {
  const shown = picker.window(pickerRows(viewport.height));
  const selected = picker.selected?.value;
  const tab = picker.tabName;
  const empty = shown.length === 0;

  const height = 5 + Math.max(1, shown.length) + (empty || tab || status ? 2 : 0) + 1;
  const frame = dialogPanel(viewport, height, picker.title);
  const { panel: canvas } = frame;
  const { width } = canvas;
  const inset = DIALOG_INSET;
  const room = width - inset * 2;
  const selectedLabel = accentSelection ? "onAccent" : "selectedBold";
  const selectedDetail = accentSelection ? "onAccent" : "selection";

  const search = `${picker.query || picker.placeholder}▏`;
  canvas.put(3, inset, search, picker.query ? "text" : "muted", room);

  shown.forEach((row, i) => {
    const y = 5 + i;
    if (!row) return;
    if ("heading" in row) {
      canvas.put(y, inset, row.heading, "accentBold", room);
      return;
    }
    const { choice } = row;
    const active = choice.value === selected;
    if (active) canvas.paint(y, 1, width - 2, accentSelection ? "accent" : "selected");
    if (choice.current) canvas.put(y, inset - 1, "●", active && accentSelection ? "onAccent" : "accent");
    const detail = Math.min(cells(choice.detail), Math.floor(room / 2));
    canvas.put(y, inset + 1, choice.label, active ? selectedLabel : "text", room - detail - 3);
    canvas.put(y, width - inset - detail, choice.detail, active ? selectedDetail : "muted", detail);
    canvas.mark(y, 1, width - 2, { kind: "choice", value: choice.value });
  });

  const footer = height - 2;
  if (status || empty) {
    canvas.put(footer, inset, (status || emptyText).replaceAll("\n", " · "), status ? "muted" : "warning", room);
  } else if (tab) {
    canvas.put(footer, inset, "tab", "text");
    canvas.put(footer, inset + 4, `${tab} ${picker.kind}s`, "muted", room - 4);
  }
  return frame;
}
