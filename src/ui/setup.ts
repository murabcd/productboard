import {
  type CliRenderer,
  type KeyEvent,
  type OptimizedBuffer,
  type PasteEvent,
  Renderable,
  RGBA,
} from "@opentui/core";
import type { ThemeId } from "../theme";
import { Canvas } from "./canvas";
import { DIALOG_INSET, type DialogFrame, dialogPanel, pickerDialog } from "./dialog";
import { editLine, type Key, keyId } from "./input";
import { pickerRows } from "./layout";
import { Picker } from "./picker";
import { textKeys, toKeys } from "./terminal-input";
import { drawCanvas, resolveTheme } from "./theme";

const LINE_BREAK = /[\r\n]/;
const SCRIM = RGBA.fromInts(0, 0, 0, 150);
const MIN_SETUP_WIDTH = 36;
const MIN_SETUP_HEIGHT = 12;

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
  title: string;
  field: Field<Result>;
  value: string;
  status: { kind: "editing"; error?: string } | { kind: "submitting" };
}

export class SetupView<Result> extends Renderable {
  private readonly theme: ReturnType<typeof resolveTheme>;
  private readonly dialog: FieldEntry<Result> | Picker<"provider">;
  private readonly abort = new AbortController();
  private frame?: DialogFrame;

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
        if (event.button !== 0 || !this.fits) return;
        const frame = this.frame;
        const target = frame?.panel.targetAt(event.x - frame.left, event.y - frame.top);
        if (target?.kind === "dismiss") this.dismiss();
        if (target?.kind === "choice" && this.dialog instanceof Picker) {
          this.dialog.choice(target.value)?.run();
        }
      },
    });
    this.theme = resolveTheme(theme);
    if ("field" in prompt) {
      const { field, title } = prompt;
      this.dialog = { title, field, value: field.value ?? "", status: { kind: "editing" } };
    } else {
      const items = prompt.choices.map(({ value, label, detail }, index) => ({
        value: String(index),
        label,
        detail,
        run: () => this.dismiss(value),
      }));
      this.dialog = new Picker("provider", prompt.title, () => items);
    }
  }

  private get fits(): boolean {
    const { width, height } = this.ctx;
    return width >= MIN_SETUP_WIDTH && height >= MIN_SETUP_HEIGHT;
  }

  key(event: KeyEvent): void {
    event.preventDefault();
    if (event.name === "escape" || (event.ctrl && event.name === "c")) {
      this.dismiss();
      return;
    }
    if (!this.fits) return;
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
    if (!this.fits) return;
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
    const dialog = this.dialog;
    if (dialog instanceof Picker) {
      const picked = dialog.handle(key, pickerRows(this.ctx.height));
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
    const { width, height } = buffer;
    buffer.fillRect(0, 0, width, height, SCRIM);
    if (!this.fits) {
      this.frame = undefined;
      const message = new Canvas(width, 1, "panel");
      message.put(0, 0, "Enlarge the terminal · Esc to exit", "muted");
      drawCanvas(buffer, message, this.theme);
      return;
    }
    const frame =
      this.dialog instanceof Picker
        ? pickerDialog(buffer, this.dialog, "No integrations found", {
            accentSelection: true,
          })
        : this.fieldPanel(buffer, this.dialog);
    this.frame = frame;
    drawCanvas(buffer, frame.panel, this.theme, frame);
  }

  private fieldPanel(viewport: Pick<OptimizedBuffer, "width" | "height">, entry: FieldEntry<Result>): DialogFrame {
    const { field, status } = entry;
    const error = status.kind === "editing" ? status.error : undefined;
    const inset = DIALOG_INSET;
    const frame = dialogPanel(viewport, 7 + Number(!!field.hint) + Number(!!field.url) + Number(!!error), entry.title);
    const { panel } = frame;
    const room = panel.width - inset * 2;
    let row = 3;
    if (field.hint) panel.put(row++, inset, field.hint, "muted", room);
    if (field.url) panel.put(row++, inset, field.url, "link", room);
    const value = field.secret ? "•".repeat(entry.value.length) : entry.value;
    panel.put(row++, inset, value ? `${value.slice(1 - room)}▏` : `${field.label}▏`, value ? "text" : "muted", room);
    if (error) panel.put(row++, inset, error, "error", room);
    if (status.kind === "submitting") {
      panel.put(row + 1, inset, "Connecting…", "muted", room);
    } else {
      panel.put(row + 1, inset, "submit", "text");
      panel.put(row + 1, inset + 7, "enter", "muted");
      if (field.url) {
        panel.put(row + 1, inset + 15, "open", "text");
        panel.put(row + 1, inset + 20, "ctrl+o", "muted");
      }
    }
    return frame;
  }
}
