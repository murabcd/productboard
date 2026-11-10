import { cells } from "../text";
import type { Canvas } from "./canvas";
import type { Dashboard } from "./dashboard";
import { DIALOG_WIDTH, pickerRows } from "./layout";
import type { Picker } from "./picker";
import { PICKERS } from "./pickers";

/** Text starts this far in; choices keep one more cell for the ● mark. */
const INSET = 3;

type Row = { heading: string } | { index: number };

export function drawDialog(canvas: Canvas, d: Dashboard, picker: Picker): void {
  const choices = picker.visible();
  picker.index = Math.max(0, Math.min(picker.index, choices.length - 1));

  // Choices under a heading wherever the group changes; headings after the first get a gap.
  const rows: (Row | null)[] = [];
  choices.forEach((choice, index) => {
    const group = choice.group ?? "";
    if (group && group !== choices[index - 1]?.group) rows.push(...(rows.length ? [null] : []), { heading: group });
    rows.push({ index });
  });
  const available = pickerRows(canvas.height);
  const selectedRow = rows.findIndex((row) => row !== null && "index" in row && row.index === picker.index);
  picker.offset = Math.min(picker.offset, Math.max(0, selectedRow - 1));
  if (selectedRow >= picker.offset + available) picker.offset = selectedRow - available + 1;
  const shown = rows.slice(picker.offset, picker.offset + available);
  const empty = PICKERS[picker.kind].empty?.(d) ?? "No matches";
  const footer = choices.length === 0 ? empty : picker.tabs.length ? "tab" : "";

  const width = Math.min(DIALOG_WIDTH, canvas.width - 4);
  const height = 5 + Math.max(1, shown.length) + (footer ? 2 : 0) + 1;
  const left = Math.floor((canvas.width - width) / 2);
  const top = Math.max(1, Math.floor((canvas.height - height) / 3));
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
  const search = picker.query ? `${picker.query}▏` : `${picker.kind === "model" ? "Search models" : "Search"}▏`;
  canvas.put(top + 3, left + INSET, search, picker.query ? "text" : "muted", room);

  shown.forEach((row, i) => {
    const y = top + 5 + i;
    if (!row) return;
    if ("heading" in row) {
      canvas.put(y, left + INSET, row.heading, "accentBold", room);
      return;
    }
    const choice = choices[row.index];
    if (!choice) return;
    const active = row.index === picker.index;
    if (active) canvas.paint(y, left + 1, width - 2, "selected");
    if (choice.current) canvas.put(y, left + INSET - 1, "●", "accent");
    const detail = Math.min(cells(choice.detail), Math.floor(room / 2));
    canvas.put(y, left + INSET + 1, choice.label, active ? "selectedBold" : "text", room - detail - 3);
    canvas.put(y, left + width - INSET - detail, choice.detail, active ? "selection" : "muted", detail);
    canvas.mark(y, left + 1, width - 2, { kind: "choice", index: row.index });
  });

  if (footer === "tab") {
    const y = top + height - 2;
    canvas.put(y, left + INSET, "tab", "text");
    canvas.put(y, left + INSET + 4, `${picker.tabName} ${picker.kind}s`, "muted", room - 4);
  } else if (footer) {
    canvas.put(top + height - 2, left + INSET, footer.replaceAll("\n", " · "), "warning", room);
  }
}
