import { cells } from "../text";
import { Canvas, type Rect } from "./canvas";
import { type AgentLayout, pickerRows } from "./layout";
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
  { accentSelection = false }: { accentSelection?: boolean } = {},
): DialogFrame {
  const shown = picker.window(pickerRows(viewport.height));
  const tab = picker.tabName;
  const empty = shown.length === 0;

  const height = 5 + Math.max(1, shown.length) + (empty || tab ? 2 : 0) + 1;
  const frame = dialogPanel(viewport, height, picker.title);
  const { panel: canvas } = frame;
  const inset = DIALOG_INSET;
  const room = canvas.width - inset * 2;
  canvas.search(3, inset, room, picker.searchEdit);
  drawPickerRows(canvas, picker, shown, 5, inset, accentSelection);

  const footer = height - 2;
  if (empty) {
    canvas.put(footer, inset, emptyText.replaceAll("\n", " · "), "warning", room);
  } else if (tab) {
    canvas.put(footer, inset, "tab", "text");
    canvas.put(footer, inset + 4, `${tab} ${picker.kind}s`, "muted", room - 4);
  }
  return frame;
}

export function drawComposerMenu(
  canvas: Canvas,
  layout: AgentLayout,
  picker: Picker,
  capacity: number,
  message: string,
): void {
  const shown = picker.window(capacity);
  const width = layout.transcript.room;
  const commands = picker.kind === "agent-commands";
  const { composerHeaderRows: headerRows } = picker;
  const panel = new Canvas(width, headerRows + shown.length + Number(!!message), commands ? "raised" : "panel");
  for (let y = 0; y < panel.height; y++) panel.mark(y, 0, width, { kind: "dialog" });
  if (headerRows) {
    panel.search(0, 2, width - 8, picker.searchEdit);
    panel.put(0, width - 5, "esc", "muted");
    panel.mark(0, width - 5, 3, { kind: "dismiss" });
  }
  drawPickerRows(panel, picker, shown, headerRows, 1, true);
  if (message) panel.put(headerRows + shown.length, 2, message.replaceAll("\n", " · "), "muted", width - 4);
  canvas.paste(panel, layout.left, layout.boxTop - panel.height);
}

function drawPickerRows(
  canvas: Canvas,
  picker: Picker<string>,
  shown: ReturnType<Picker<string>["window"]>,
  top: number,
  inset: number,
  accentSelection: boolean,
): void {
  const { width } = canvas;
  const { detailLayout } = picker;
  const room = width - inset * 2;
  const labelColumn = inset + 1;
  const fixedColumn = typeof detailLayout === "number" ? detailLayout : undefined;
  const selected = picker.selected?.value;
  const selectedLabel = accentSelection ? "onAccent" : "selectedBold";
  const selectedDetail = accentSelection ? "onAccent" : "selection";

  shown.forEach((row, i) => {
    const y = top + i;
    if (!row) return;
    if ("heading" in row) {
      canvas.put(y, picker.placement === "composer" ? labelColumn : inset, row.heading, "accentBold", room);
      return;
    }
    const { choice } = row;
    const active = choice.value === selected;
    if (active) canvas.paint(y, 1, width - 2, accentSelection ? "accent" : "selected");
    if (choice.current) canvas.put(y, inset - 1, "●", active && accentSelection ? "onAccent" : "accent");
    const trailing = width - inset - Math.min(cells(choice.detail), Math.floor(room / 2));
    const detailLeft = fixedColumn ?? trailing;
    canvas.put(y, labelColumn, choice.label, active ? selectedLabel : "text", detailLeft - labelColumn - 2);
    canvas.put(y, detailLeft, choice.detail, active ? selectedDetail : "muted", width - inset - detailLeft);
    canvas.mark(y, 1, width - 2, { kind: "choice", value: choice.value });
  });
}
