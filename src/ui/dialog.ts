import { cells } from "../text";
import type { Canvas } from "./canvas";
import { DIALOG_WIDTH, pickerRows } from "./layout";
import type { Picker } from "./picker";

/** Text starts this far in; choices keep one more cell for the ● mark. */
const INSET = 3;

export function drawDialog(canvas: Canvas, picker: Picker, emptyText: string, status?: string): void {
  const shown = picker.window(pickerRows(canvas.height));
  const selected = picker.selected?.value;
  const tab = picker.tabName;
  const empty = shown.length === 0;

  const width = Math.min(DIALOG_WIDTH, canvas.width - 4);
  const height = 5 + Math.max(1, shown.length) + (empty || tab || status ? 2 : 0) + 1;
  const left = Math.floor((canvas.width - width) / 2);
  const top = Math.floor((canvas.height - height) / 2);
  const room = width - INSET * 2;
  // Opaque: nothing from the page shows through.
  for (let y = top; y < top + height; y++) {
    canvas.put(y, left, " ".repeat(width), "text");
    canvas.paint(y, left, width, "panel");
    canvas.mark(y, left, width, { kind: "dialog" });
  }

  canvas.put(top + 1, left + INSET, picker.title, "title", room - 5);
  canvas.put(top + 1, left + width - INSET - 3, "esc", "muted");
  canvas.mark(top + 1, left + width - INSET - 3, 3, { kind: "dismiss" });
  const search = `${picker.query || picker.placeholder}▏`;
  canvas.put(top + 3, left + INSET, search, picker.query ? "text" : "muted", room);

  shown.forEach((row, i) => {
    const y = top + 5 + i;
    if (!row) return;
    if ("heading" in row) {
      canvas.put(y, left + INSET, row.heading, "accentBold", room);
      return;
    }
    const { choice } = row;
    const active = choice.value === selected;
    if (active) canvas.paint(y, left + 1, width - 2, "selected");
    if (choice.current) canvas.put(y, left + INSET - 1, "●", "accent");
    const detail = Math.min(cells(choice.detail), Math.floor(room / 2));
    canvas.put(y, left + INSET + 1, choice.label, active ? "selectedBold" : "text", room - detail - 3);
    canvas.put(y, left + width - INSET - detail, choice.detail, active ? "selection" : "muted", detail);
    canvas.mark(y, left + 1, width - 2, { kind: "choice", value: choice.value });
  });

  const footer = top + height - 2;
  if (status || empty) {
    canvas.put(footer, left + INSET, (status || emptyText).replaceAll("\n", " · "), status ? "muted" : "warning", room);
  } else if (tab) {
    canvas.put(footer, left + INSET, "tab", "text");
    canvas.put(footer, left + INSET + 4, `${tab} ${picker.kind}s`, "muted", room - 4);
  }
}
