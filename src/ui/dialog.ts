import { cells } from "../text";
import { Canvas } from "./canvas";
import { DIALOG_WIDTH, pickerRows } from "./layout";
import type { Picker } from "./picker";

/** Text starts this far in; choices keep one more cell for the ● mark. */
export const DIALOG_INSET = 3;

export function drawDialog(canvas: Canvas, picker: Picker<string>, emptyText: string, status?: string): void {
  const width = Math.min(DIALOG_WIDTH, canvas.width - 4);
  const panel = pickerDialog(width, pickerRows(canvas.height), picker, emptyText, { status });
  canvas.paste(panel, Math.floor((canvas.width - width) / 2), Math.floor((canvas.height - panel.height) / 2));
}

export function dialogPanel(width: number, height: number, title: string): Canvas {
  const panel = new Canvas(width, height, "panel");
  for (let y = 0; y < height; y++) panel.mark(y, 0, width, { kind: "dialog" });
  const close = width - DIALOG_INSET - 3;
  panel.put(1, DIALOG_INSET, title, "title", close - DIALOG_INSET - 2);
  panel.put(1, close, "esc", "muted");
  panel.mark(1, close, 3, { kind: "dismiss" });
  return panel;
}

export function pickerDialog(
  width: number,
  capacity: number,
  picker: Picker<string>,
  emptyText: string,
  { status, accentSelection = false }: { status?: string; accentSelection?: boolean } = {},
): Canvas {
  const shown = picker.window(capacity);
  const selected = picker.selected?.value;
  const tab = picker.tabName;
  const empty = shown.length === 0;

  const height = 5 + Math.max(1, shown.length) + (empty || tab || status ? 2 : 0) + 1;
  const canvas = dialogPanel(width, height, picker.title);
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
  return canvas;
}
