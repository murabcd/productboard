import { type CliRenderer, type KeyEvent, type OptimizedBuffer, type PasteEvent, Renderable } from "@opentui/core";
import type { ThemeId } from "../theme";
import { Canvas } from "./canvas";
import { drawDialog } from "./dialog";
import { editLine, type Key, keyId } from "./input";
import { pickerRows } from "./layout";
import { Picker, type PickerItem } from "./picker";
import { textKeys, toKeys } from "./terminal-input";
import { drawCanvas, resolveTheme } from "./theme";

const LINE_BREAK = /[\r\n]/;

interface Field<Result> {
  label: string;
  value?: string;
  hint?: string;
  url?: string;
  secret?: boolean;
  submit(value: string, signal: AbortSignal): Result | Promise<Result>;
}

interface Choice<Result> {
  value: Result;
  label: string;
  detail: string;
}

export type SetupPrompt<Result> = { title: string } & ({ field: Field<Result> } | { choices: Choice<Result>[] });

interface FieldEntry<Result> {
  field: Field<Result>;
  value: string;
  status: { kind: "editing"; error?: string } | { kind: "submitting" };
}

export class SetupView<Result> extends Renderable {
  private readonly theme: ReturnType<typeof resolveTheme>;
  private readonly title: string;
  private readonly dialog: FieldEntry<Result> | { picker: Picker<string>; items: PickerItem[] };
  private readonly abort = new AbortController();
  private canvas?: Canvas;

  constructor(
    renderer: CliRenderer,
    theme: ThemeId,
    prompt: SetupPrompt<Result>,
    private readonly open: (url: string) => Promise<void>,
    private readonly finish: (value?: Result) => void,
  ) {
    super(renderer, {
      id: "setup",
      width: "100%",
      height: "100%",
      position: "absolute",
      top: 0,
      left: 0,
      zIndex: 10,
      onMouseDown: (event) => {
        if (event.button !== 0) return;
        const target = this.canvas?.targetAt(event.x, event.y);
        if (target?.kind === "dismiss") this.dismiss();
        if (target?.kind === "choice" && "items" in this.dialog) {
          this.dialog.items.find((item) => item.value === target.value)?.run();
        }
      },
    });
    this.title = prompt.title;
    this.theme = resolveTheme(theme);
    if ("field" in prompt) {
      this.dialog = { field: prompt.field, value: prompt.field.value ?? "", status: { kind: "editing" } };
    } else {
      const items = prompt.choices.map(({ value, label, detail }, index) => ({
        value: String(index),
        label,
        detail,
        run: () => this.dismiss(value),
      }));
      this.dialog = { items, picker: new Picker("provider", prompt.title, items, { placeholder: "Search providers" }) };
    }
  }

  key(event: KeyEvent): void {
    event.preventDefault();
    const dialog = this.dialog;
    if (event.ctrl && event.name === "o" && "field" in dialog && dialog.field.url && dialog.status.kind === "editing") {
      void this.open(dialog.field.url).catch(() => {
        if (this.abort.signal.aborted || dialog.status.kind !== "editing") return;
        dialog.status = { kind: "editing", error: "Open the link in your browser." };
        this.requestRender();
      });
      return;
    }
    for (const key of toKeys(event)) this.handle(key);
  }

  paste(event: PasteEvent): void {
    event.preventDefault();
    const line = new TextDecoder().decode(event.bytes).split(LINE_BREAK, 1)[0] ?? "";
    for (const key of textKeys(line)) this.handle(key);
  }

  dismiss(value?: Result): void {
    if (this.abort.signal.aborted) return;
    this.abort.abort();
    if ("field" in this.dialog) this.dialog.value = "";
    this.finish(value);
  }

  private handle(key: Key): void {
    if (this.abort.signal.aborted) return;
    const id = keyId(key);
    if (id === "escape" || id === "ctrl-c") {
      this.dismiss();
      return;
    }
    const dialog = this.dialog;
    if ("picker" in dialog) {
      const picked = dialog.picker.handle(key, pickerRows(this.height));
      if (picked && picked !== "dismiss") picked.run();
    } else if (dialog.status.kind === "editing") {
      if (id === "enter") void this.submit(dialog);
      const value = editLine(dialog.value, key, 2048);
      if (value !== undefined) {
        dialog.value = value;
        dialog.status = { kind: "editing" };
      }
    }
    if (!this.abort.signal.aborted) this.requestRender();
  }

  private async submit(entry: FieldEntry<Result>): Promise<void> {
    const { field } = entry;
    entry.status = { kind: "submitting" };
    const value = entry.value.trim();
    if (field.secret) entry.value = "";
    try {
      const result = await field.submit(value, this.abort.signal);
      this.dismiss(result);
    } catch (error) {
      if (this.abort.signal.aborted) return;
      entry.status = { kind: "editing", error: error instanceof Error ? error.message : "Connection failed." };
      this.requestRender();
    }
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const canvas = new Canvas(buffer.width, buffer.height);
    this.canvas = canvas;
    if (buffer.width < 36 || buffer.height < 12) {
      canvas.put(0, 0, "Enlarge the terminal · Esc to exit", "muted");
    } else if ("picker" in this.dialog) {
      const { picker } = this.dialog;
      drawDialog(canvas, picker, "No providers match", picker.selected && "↑ ↓ Select · Enter Continue");
    } else {
      this.drawField(canvas, this.dialog);
    }
    drawCanvas(buffer, canvas, this.theme);
  }

  private drawField(canvas: Canvas, entry: FieldEntry<Result>): void {
    const { field, status } = entry;
    const width = Math.min(68, canvas.width - 4);
    const left = Math.floor((canvas.width - width) / 2);
    const top = Math.floor((canvas.height - 10) / 2);
    const room = width - 6;
    for (let y = top; y < top + 10; y++) canvas.paint(y, left, width, "panel");
    canvas.put(top + 1, left + 3, this.title, "title", room - 5);
    canvas.put(top + 1, left + width - 6, "esc", "muted");
    canvas.mark(top + 1, left + width - 6, 3, { kind: "dismiss" });
    if (field.hint) canvas.put(top + 3, left + 3, field.hint, "muted", room);
    if (field.url) canvas.put(top + 4, left + 3, field.url, "link", room);
    const value = field.secret ? "•".repeat(entry.value.length) : entry.value;
    canvas.paint(top + 6, left + 2, width - 4, "raised");
    const error = status.kind === "editing" ? status.error : undefined;
    canvas.put(
      top + 6,
      left + 3,
      value ? `${value.slice(1 - room)}▏` : `${field.label}▏`,
      value ? "text" : "muted",
      room,
    );
    canvas.put(
      top + 8,
      left + 3,
      error ||
        (status.kind === "submitting" ? "Connecting…" : `Enter Continue${field.url ? " · Ctrl+O Open link" : ""}`),
      error ? "error" : "muted",
      room,
    );
  }
}
