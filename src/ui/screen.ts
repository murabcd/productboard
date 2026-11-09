/** OpenTUI shell: draws the dashboard's frame and feeds it keys. */

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
} from "@opentui/core";
import { cells, splitGraphemes } from "../text";
import type { Canvas, Style } from "./canvas";
import type { Dashboard } from "./dashboard";
import { frame } from "./frame";
import type { Key, KeyName } from "./input";
import { previewArea } from "./layout";

const NONE = RGBA.fromValues(0, 0, 0, 0);
const hex = (value: string) => RGBA.fromHex(value);
const SELECTION = hex("#3a3a3a");

const STYLES: Record<Style, { fg: RGBA; bg: RGBA; attributes: number }> = {
  text: { fg: hex("#d0d0d0"), bg: NONE, attributes: TextAttributes.NONE },
  title: { fg: hex("#d0d0d0"), bg: NONE, attributes: TextAttributes.BOLD },
  muted: { fg: hex("#8a8a8a"), bg: NONE, attributes: TextAttributes.NONE },
  mutedBold: { fg: hex("#8a8a8a"), bg: NONE, attributes: TextAttributes.BOLD },
  accent: { fg: hex("#87afd7"), bg: NONE, attributes: TextAttributes.NONE },
  accentBold: { fg: hex("#87afd7"), bg: NONE, attributes: TextAttributes.BOLD },
  done: { fg: hex("#87d787"), bg: NONE, attributes: TextAttributes.NONE },
  italic: { fg: hex("#d0d0d0"), bg: NONE, attributes: TextAttributes.ITALIC },
  code: { fg: hex("#d7af87"), bg: hex("#262626"), attributes: TextAttributes.NONE },
  link: { fg: hex("#87afd7"), bg: NONE, attributes: TextAttributes.UNDERLINE },
  strike: { fg: hex("#8a8a8a"), bg: NONE, attributes: TextAttributes.STRIKETHROUGH },
  status: { fg: hex("#1c1c1c"), bg: hex("#87afd7"), attributes: TextAttributes.BOLD },
  warning: { fg: hex("#d7af5f"), bg: NONE, attributes: TextAttributes.NONE },
  mention: { fg: hex("#d7af5f"), bg: NONE, attributes: TextAttributes.BOLD },
  error: { fg: hex("#d75f5f"), bg: NONE, attributes: TextAttributes.NONE },
  selection: { fg: hex("#d0d0d0"), bg: SELECTION, attributes: TextAttributes.NONE },
  selectedBold: { fg: hex("#d0d0d0"), bg: SELECTION, attributes: TextAttributes.BOLD },
};

/** Draws the whole dashboard; the frame decides every cell except an image
 * preview, which OpenTUI draws with the best protocol the terminal supports. */
class DashboardView extends Renderable {
  private readonly image: ImageRenderable;
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
        dashboard.wheel(direction === "down" ? 1 : -1);
        this.requestRender();
      },
    });
    this.image = new ImageRenderable(ctx, { id: "preview", position: "absolute", fit: "fit", visible: false });
    this.add(this.image);
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const { width, height } = buffer;
    this.dashboard.height = height;
    const canvas = frame(this.dashboard, width, height);
    this.canvas = canvas;
    for (let y = 0; y < height; y++) {
      let x = 0;
      for (const run of canvas.runs(y)) {
        const style = STYLES[run.style];
        buffer.drawText(run.text, x, y, style.fg, style.bg, style.attributes);
        x += cells(run.text);
      }
    }
    this.placeImage(width, height);
  }

  /** Show the previewed image in its area, or hide it. */
  private placeImage(width: number, height: number): void {
    const bytes = this.dashboard.preview?.bytes ?? null;
    if (this.image.visible !== (bytes !== null)) {
      this.image.visible = bytes !== null;
      this.requestRender();
    }
    if (!bytes) return;
    if (this.image.source !== bytes) this.image.source = bytes;
    const area = previewArea(width, height);
    if (
      this.image.x !== area.left ||
      this.image.y !== area.top ||
      this.image.width !== area.width ||
      this.image.height !== area.height
    ) {
      Object.assign(this.image, area);
      this.requestRender();
    }
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

/** An OpenTUI key event as dashboard keys. */
export function toKeys(key: Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift" | "sequence">): Key[] {
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
  renderer.keyInput.on("keypress", (key) => feed(toKeys(key)));
  renderer.keyInput.on("paste", (event) => feed(textKeys(new TextDecoder().decode(event.bytes))));
  renderer.requestRender();
}

export interface Screen {
  /** Schedule a new frame after state changes. */
  redraw(): void;
  /** Show the dashboard until the user quits. */
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
