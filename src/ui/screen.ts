import {
  type CliRenderer,
  createCliRenderer,
  ImageRenderable,
  type KeyEvent,
  type OptimizedBuffer,
  Renderable,
  type RenderContext,
  RGBA,
  TextAttributes,
  TextareaRenderable,
} from "@opentui/core";
import { cells, splitGraphemes } from "../text";
import { COMPOSER_MAX_ROWS, SCANNER_FRAME_MS } from "./agent";
import type { Canvas, Rect, ScannerStyle, Style, Surface, TextStyle } from "./canvas";
import type { Dashboard } from "./dashboard";
import { frame } from "./frame";
import type { Key, KeyName } from "./input";

const NONE = RGBA.fromValues(0, 0, 0, 0);
const hex = (value: string) => RGBA.fromHex(value);
const SELECTION = hex("#292d40");
const SURFACES: Record<Surface, RGBA> = {
  workspace: hex("#151619"),
  chrome: hex("#111215"),
  raised: hex("#22253a"),
  selected: SELECTION,
  panel: hex("#1a1b21"),
};

const ACCENT = hex("#b8c1ff");
const GLARE = RGBA.fromValues(
  Math.min(1, ACCENT.r * 1.15),
  Math.min(1, ACCENT.g * 1.15),
  Math.min(1, ACCENT.b * 1.15),
  1,
);

/** Resting blocks pulse between 30% and 100% of their base brightness. */
const SCANNER: Record<ScannerStyle, [color: RGBA, alpha: number]> = {
  trail0: [ACCENT, 1],
  trail1: [GLARE, 0.9],
  trail2: [ACCENT, 0.65],
  trail3: [ACCENT, 0.65 ** 2],
  trail4: [ACCENT, 0.65 ** 3],
  trail5: [ACCENT, 0.65 ** 4],
  idle0: [ACCENT, 0.6 * 0.3],
  idle1: [ACCENT, 0.6 * 0.53],
  idle2: [ACCENT, 0.6 * 0.77],
  idle3: [ACCENT, 0.6],
};

/** A scanner shade blended over the background it sits on, since terminals have no transparency. */
function blend([color, alpha]: [RGBA, number], background: RGBA): RGBA {
  const mix = (front: number, back: number) => front * alpha + back * (1 - alpha);
  return RGBA.fromValues(mix(color.r, background.r), mix(color.g, background.g), mix(color.b, background.b), 1);
}

const isScanner = (style: Style): style is ScannerStyle => style in SCANNER;

const STYLES: Record<TextStyle, { fg: RGBA; bg: RGBA; attributes: number }> = {
  line: { fg: hex("#353743"), bg: NONE, attributes: TextAttributes.NONE },
  text: { fg: hex("#e3e4ec"), bg: NONE, attributes: TextAttributes.NONE },
  title: { fg: hex("#e3e4ec"), bg: NONE, attributes: TextAttributes.BOLD },
  muted: { fg: hex("#a2a5b5"), bg: NONE, attributes: TextAttributes.NONE },
  mutedBold: { fg: hex("#a2a5b5"), bg: NONE, attributes: TextAttributes.BOLD },
  accent: { fg: hex("#b8c1ff"), bg: NONE, attributes: TextAttributes.NONE },
  accentBold: { fg: hex("#b8c1ff"), bg: NONE, attributes: TextAttributes.BOLD },
  done: { fg: hex("#96d8b7"), bg: NONE, attributes: TextAttributes.NONE },
  italic: { fg: hex("#e3e4ec"), bg: NONE, attributes: TextAttributes.ITALIC },
  code: { fg: hex("#d7af87"), bg: hex("#262626"), attributes: TextAttributes.NONE },
  link: { fg: hex("#b8c1ff"), bg: NONE, attributes: TextAttributes.UNDERLINE },
  strike: { fg: hex("#a2a5b5"), bg: NONE, attributes: TextAttributes.STRIKETHROUGH },
  status: { fg: hex("#1c1c1c"), bg: hex("#b8c1ff"), attributes: TextAttributes.BOLD },
  review: { fg: hex("#cbb6f4"), bg: NONE, attributes: TextAttributes.NONE },
  ship: { fg: hex("#5fd7d7"), bg: NONE, attributes: TextAttributes.NONE },
  warning: { fg: hex("#d7af5f"), bg: NONE, attributes: TextAttributes.NONE },
  mention: { fg: hex("#d7af5f"), bg: NONE, attributes: TextAttributes.BOLD },
  error: { fg: hex("#f0a4a8"), bg: NONE, attributes: TextAttributes.NONE },
  selection: { fg: hex("#e3e4ec"), bg: SELECTION, attributes: TextAttributes.NONE },
  selectedBold: { fg: hex("#e3e4ec"), bg: SELECTION, attributes: TextAttributes.BOLD },
};

/** Keys the dashboard keeps while the Agent text box has focus; the rest are typing. */
const COMPOSER_KEYS = new Set<KeyName>([
  "escape",
  "ctrl-c",
  "agent-new",
  "agent-stop",
  "agent-previous",
  "agent-next",
  "agent-cited",
  "commands",
  "pageup",
  "pagedown",
]);

/** Enter sends; Shift+Enter or Ctrl+J starts a new line. */
const COMPOSER_BINDINGS = [
  { name: "return", action: "submit" },
  { name: "kpenter", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "linefeed", action: "newline" },
] as const;

class DashboardView extends Renderable {
  private readonly image: ImageRenderable;
  private readonly composer: TextareaRenderable;
  private animation: ReturnType<typeof setTimeout> | undefined;
  /** The last frame drawn, which knows what each click hits. */
  private canvas: Canvas | undefined;

  constructor(
    ctx: RenderContext,
    private readonly dashboard: Dashboard,
  ) {
    super(ctx, {
      id: "dashboard",
      width: "100%",
      height: "100%",
      onMouseDown: (event) => {
        const target = this.canvas?.targetAt(event.x, event.y);
        if (event.button !== 0 || !target) return;
        dashboard.click(target);
        this.requestRender();
      },
      onMouseScroll: (event) => {
        const direction = event.scroll?.direction;
        if (direction !== "up" && direction !== "down") return;
        dashboard.wheel(direction === "down" ? 1 : -1, this.canvas?.targetAt(event.x, event.y));
        this.requestRender();
      },
    });
    this.image = new ImageRenderable(ctx, { id: "preview", position: "absolute", fit: "fit", visible: false });
    this.composer = new TextareaRenderable(ctx, {
      id: "composer",
      position: "absolute",
      visible: false,
      wrapMode: "word",
      placeholderColor: STYLES.muted.fg,
      textColor: STYLES.text.fg,
      focusedTextColor: STYLES.text.fg,
      backgroundColor: SURFACES.raised,
      focusedBackgroundColor: SURFACES.raised,
      cursorColor: STYLES.accent.fg,
      selectionBg: SELECTION,
      keyBindings: [...COMPOSER_BINDINGS],
      onContentChange: () => {
        dashboard.agent.chat.current.draft = this.composer.plainText;
        this.fitComposer();
        this.requestRender();
      },
      onSubmit: () => {
        dashboard.agent.send();
        this.requestRender();
      },
    });
    this.add(this.image);
    this.add(this.composer);
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const { width, height } = buffer;
    if (this.composer.visible) this.fitComposer();
    this.dashboard.resize(width, height);
    const canvas = frame(this.dashboard);
    this.canvas = canvas;
    for (let y = 0; y < height; y++) {
      let x = 0;
      for (const run of canvas.runs(y)) {
        const surface = SURFACES[run.surface ?? "workspace"];
        if (isScanner(run.style)) {
          buffer.drawText(run.text, x, y, blend(SCANNER[run.style], surface), surface, TextAttributes.NONE);
        } else {
          const style = STYLES[run.style];
          const background = style.bg === NONE ? surface : style.bg;
          buffer.drawText(run.text, x, y, style.fg, background, style.attributes);
        }
        x += cells(run.text);
      }
    }
    this.placeImage(canvas.reserved("image"));
    this.placeComposer(canvas.reserved("composer"));
    this.animate();
  }

  /** Show `renderable` over `area`, or hide it; returns whether it is shown. */
  private place(renderable: ImageRenderable | TextareaRenderable, area: Rect | undefined): boolean {
    if (!area) {
      if (renderable.visible) {
        renderable.visible = false;
        this.requestRender();
      }
      return false;
    }
    const { left, top, width, height } = area;
    if (
      !renderable.visible ||
      renderable.x !== left ||
      renderable.y !== top ||
      renderable.width !== width ||
      renderable.height !== height
    ) {
      Object.assign(renderable, { x: left, y: top, width, height, visible: true });
      this.requestRender();
    }
    return true;
  }

  private placeImage(area: Rect | undefined): void {
    const state = this.dashboard.preview?.read.state;
    if (!this.place(this.image, area) || state?.kind !== "ready") return;
    if (this.image.source !== state.bytes) this.image.source = state.bytes;
  }

  private placeComposer(area: Rect | undefined): void {
    if (!this.place(this.composer, area)) {
      this.composer.blur();
      return;
    }
    const { chat } = this.dashboard.agent;
    // The draft changes outside the box too: sending clears it, a failed send restores it.
    if (this.composer.plainText !== chat.current.draft) {
      this.composer.setText(chat.current.draft);
      this.fitComposer();
    }
    this.composer.placeholder = chat.configured ? "Message Agent…" : "Agent is not set up";
    this.composer.focus();
  }

  /** Let the frame grow the box with its lines. Wrapped lines are counted
   * after the box draws, so a change asks for one more frame. */
  private fitComposer(): void {
    const lines = Math.max(this.composer.lineCount, this.composer.virtualLineCount);
    const rows = Math.max(1, Math.min(COMPOSER_MAX_ROWS, lines));
    if (rows === this.dashboard.agent.composerRows) return;
    this.dashboard.agent.composerRows = rows;
    this.requestRender();
  }

  /** Keep drawing while a reply streams, once per scanner step, then stop. */
  private animate(): void {
    if (this.animation || !this.composer.visible || !this.dashboard.agent.chat.current.pending) return;
    this.animation = setTimeout(() => {
      this.animation = undefined;
      this.requestRender();
    }, SCANNER_FRAME_MS);
  }
}

const NAMED: Record<string, KeyName> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  pageup: "pageup",
  pagedown: "pagedown",
  home: "home",
  end: "end",
  return: "enter",
  enter: "enter",
  linefeed: "enter",
  escape: "escape",
  tab: "tab",
  backspace: "backspace",
  delete: "backspace",
};

export function toKeys(key: Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift" | "sequence" | "super">): Key[] {
  if ((key.ctrl && key.name === "k") || (key.super && key.name === "k")) return [{ name: "commands" }];
  if (key.ctrl && key.name === "n") return [{ name: "agent-new" }];
  if (key.ctrl && key.name === "x") return [{ name: "agent-stop" }];
  if (key.ctrl && key.name === "up") return [{ name: "agent-previous" }];
  if (key.ctrl && key.name === "down") return [{ name: "agent-next" }];
  if (key.ctrl && key.name === "o") return [{ name: "agent-cited" }];
  if (key.ctrl && key.name === "c") return [{ name: "ctrl-c" }];
  const named = NAMED[key.name];
  if (named) return named === "tab" && key.shift ? [] : [{ name: named }];
  if (key.ctrl || key.meta) return [];
  return textKeys(key.sequence);
}

/** Typed or pasted text, one key per character, without control characters. */
export function textKeys(text: string): Key[] {
  return splitGraphemes(text)
    .filter((ch) => ch >= " " && ch !== "\u007f")
    .map((ch) => ({ text: ch }));
}

/** Attach the dashboard to a renderer; `quit` runs when the user exits. */
export function mount(renderer: CliRenderer, dashboard: Dashboard, quit: () => void): void {
  renderer.root.add(new DashboardView(renderer, dashboard));
  const feed = (keys: Key[]) => {
    for (const next of keys) {
      if (!dashboard.handle(next)) {
        quit();
        return;
      }
    }
    renderer.requestRender();
  };
  renderer.keyInput.on("keypress", (key) => {
    const keys = toKeys(key);
    const dashboardKeys =
      dashboard.layer().kind === "agent" ? keys.filter((k) => "name" in k && COMPOSER_KEYS.has(k.name)) : keys;
    if (dashboardKeys.length === 0) return;
    key.preventDefault();
    feed(dashboardKeys);
  });
  renderer.keyInput.on("paste", (event) => {
    if (dashboard.layer().kind === "agent") return;
    event.preventDefault();
    feed(textKeys(new TextDecoder().decode(event.bytes)));
  });
  renderer.requestRender();
}

export interface Screen {
  redraw(): void;
  show(dashboard: Dashboard): Promise<void>;
  /** Restore the terminal. Safe to call more than once. */
  close(): Promise<void>;
}

/** Take over the terminal; call `close` when done, even after an error. */
export async function openScreen(): Promise<Screen> {
  const renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    exitOnCtrlC: false,
    useMouse: true,
    targetFps: 30,
  });
  return {
    redraw: () => renderer.requestRender(),
    show: (dashboard) => new Promise<void>((resolve) => mount(renderer, dashboard, resolve)),
    close: async () => {
      if (!renderer.isDestroyed) renderer.destroy();
      await renderer.closed;
    },
  };
}
