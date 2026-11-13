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
import { isSearchAction, SearchInput } from "./search-input";
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

interface Confirmation<Result> {
  hint: string;
  run(signal: AbortSignal): Result | Promise<Result>;
}

interface Choice<Result> {
  value: Result;
  label: string;
  detail: string;
}

export type SetupPrompt<Result> = { title: string } & (
  | { field: Field<Result> }
  | { confirm: Confirmation<Result> }
  | { choices: Choice<Result>[] }
);

type Entry<Result> = {
  title: string;
  status: { kind: "editing"; error?: string } | { kind: "submitting" };
} & ({ field: Field<Result>; value: string } | { confirm: Confirmation<Result> });

export class SetupView<Result> extends Renderable {
  private readonly theme: ReturnType<typeof resolveTheme>;
  private readonly dialog: Entry<Result> | Picker<"provider">;
  private readonly abort = new AbortController();
  private readonly search: SearchInput;
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
    this.search = new SearchInput(renderer);
    this.add(this.search);
    if ("field" in prompt) {
      const { field, title } = prompt;
      this.dialog = { title, field, value: field.value ?? "", status: { kind: "editing" } };
    } else if ("confirm" in prompt) {
      this.dialog = { ...prompt, status: { kind: "editing" } };
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
    const keys = toKeys(event);
    if (dialog instanceof Picker && !isSearchAction(keys)) {
      this.search.key(dialog.searchEdit, event);
      this.requestRender();
      return;
    }
    if (event.ctrl && event.name === "o" && "field" in dialog && dialog.field.url && dialog.status.kind === "editing") {
      void this.open(dialog.field.url).catch(() => {
        if (this.abort.signal.aborted || dialog.status.kind !== "editing") return;
        dialog.status = { kind: "editing", error: "Open the link in your browser." };
        this.requestRender();
      });
      return;
    }
    for (const key of keys) this.handle(key);
  }

  paste(event: PasteEvent): void {
    event.preventDefault();
    if (!this.fits) return;
    const line = new TextDecoder().decode(event.bytes).split(LINE_BREAK, 1)[0] ?? "";
    if (this.dialog instanceof Picker) {
      this.search.paste(this.dialog.searchEdit, line);
      this.requestRender();
      return;
    }
    if ("field" in this.dialog) for (const key of textKeys(line)) this.handle(key);
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
      else if ("field" in dialog) {
        const value = editLine(dialog.value, key, 2048);
        if (value !== undefined) {
          dialog.value = value;
          dialog.status = { kind: "editing" };
        }
      }
    }
    if (!this.abort.signal.aborted) this.requestRender();
  }

  private async submit(entry: Entry<Result>): Promise<void> {
    entry.status = { kind: "submitting" };
    try {
      const { signal } = this.abort;
      if ("confirm" in entry) {
        this.dismiss(await entry.confirm.run(signal));
        return;
      }
      const value = entry.value.trim();
      if (entry.field.secret) entry.value = "";
      const result = await entry.field.submit(value, signal);
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
      this.search.place(undefined, undefined, this.theme);
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
        : this.entryPanel(buffer, this.dialog);
    this.frame = frame;
    drawCanvas(buffer, frame.panel, this.theme, frame);
    this.search.place(
      this.dialog instanceof Picker ? this.dialog.searchEdit : undefined,
      frame.panel.searchArea(frame),
      this.theme,
    );
  }

  private entryPanel(viewport: Pick<OptimizedBuffer, "width" | "height">, entry: Entry<Result>): DialogFrame {
    const { status } = entry;
    const field = "field" in entry ? entry.field : undefined;
    const hint = "confirm" in entry ? entry.confirm.hint : entry.field.hint;
    const error = status.kind === "editing" ? status.error : undefined;
    const inset = DIALOG_INSET;
    const rows = 6 + Number(!!field) + Number(!!hint) + Number(!!field?.url) + Number(!!error);
    const frame = dialogPanel(viewport, rows, entry.title);
    const { panel } = frame;
    const room = panel.width - inset * 2;
    let row = 3;
    if (hint) panel.put(row++, inset, hint, "muted", room);
    if (field?.url) panel.put(row++, inset, field.url, "link", room);
    if ("field" in entry) {
      const value = entry.field.secret ? "•".repeat(entry.value.length) : entry.value;
      const label = value ? `${value.slice(1 - room)}▏` : `${entry.field.label}▏`;
      panel.put(row++, inset, label, value ? "text" : "muted", room);
    }
    if (error) panel.put(row++, inset, error, "error", room);
    if (status.kind === "submitting") {
      panel.put(row + 1, inset, "Connecting…", "muted", room);
    } else {
      const action = field ? "submit" : "connect";
      panel.put(row + 1, inset, action, "text");
      panel.put(row + 1, inset + action.length + 1, "enter", "muted");
      if (field?.url) {
        panel.put(row + 1, inset + 15, "open", "text");
        panel.put(row + 1, inset + 20, "ctrl+o", "muted");
      }
    }
    return frame;
  }
}
