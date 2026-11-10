import {
  type CliRenderer,
  createCliRenderer,
  ImageRenderable,
  type KeyEvent,
  type OptimizedBuffer,
  Renderable,
  TextAttributes,
} from "@opentui/core";
import { cells, splitGraphemes } from "../text";
import { COMPOSER_MAX_ROWS, SCANNER_FRAME_MS } from "./agent";
import type { Canvas, Rect } from "./canvas";
import { AgentComposer } from "./composer";
import type { Dashboard } from "./dashboard";
import { frame } from "./frame";
import type { Key, KeyName } from "./input";
import { isScanner, resolveTheme } from "./theme";

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

class DashboardView extends Renderable {
  private readonly image: ImageRenderable;
  readonly composer: AgentComposer;
  private theme: ReturnType<typeof resolveTheme>;
  private animation: ReturnType<typeof setTimeout> | undefined;
  /** The last frame drawn, which knows what each click hits. */
  private canvas: Canvas | undefined;

  constructor(
    private readonly renderer: CliRenderer,
    private readonly dashboard: Dashboard,
  ) {
    super(renderer, {
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
    this.theme = resolveTheme(dashboard.theme);
    renderer.setBackgroundColor(this.theme.surfaces.workspace);
    this.image = new ImageRenderable(renderer, { id: "preview", position: "absolute", fit: "fit", visible: false });
    this.composer = new AgentComposer(renderer, dashboard.agent.chat, this.theme.composer, () => {
      this.fitComposer();
      this.requestRender();
    });
    this.add(this.image);
    this.add(this.composer);
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const { width, height } = buffer;
    if (this.theme.id !== this.dashboard.theme) {
      this.theme = resolveTheme(this.dashboard.theme);
      this.renderer.setBackgroundColor(this.theme.surfaces.workspace);
      Object.assign(this.composer, this.theme.composer);
    }
    const { surfaces, styles, scanner } = this.theme;
    if (this.composer.visible) this.fitComposer();
    this.dashboard.resize(width, height);
    const canvas = frame(this.dashboard);
    this.canvas = canvas;
    for (let y = 0; y < height; y++) {
      let x = 0;
      for (const run of canvas.runs(y)) {
        const surface = surfaces[run.surface ?? "workspace"];
        if (isScanner(run.style)) {
          buffer.drawText(run.text, x, y, scanner(run.style, surface), surface, TextAttributes.NONE);
        } else {
          const style = styles[run.style];
          const background = style.bg ?? surface;
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
  private place(renderable: ImageRenderable | AgentComposer, area: Rect | undefined): boolean {
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
    this.composer.sync();
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
  const view = new DashboardView(renderer, dashboard);
  renderer.root.add(view);
  dashboard.agent.attachReference = (reference) => view.composer.attachReference(reference);
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
    const editing = dashboard.layer().kind === "agent";
    if (editing) {
      view.composer.sync();
      if (key.sequence === "@" && view.composer.canMention()) {
        key.preventDefault();
        dashboard.openPicker("agent-context");
        renderer.requestRender();
        return;
      }
    }
    const dashboardKeys = editing ? keys.filter((k) => "name" in k && COMPOSER_KEYS.has(k.name)) : keys;
    if (dashboardKeys.length === 0) return;
    key.preventDefault();
    feed(dashboardKeys);
  });
  renderer.keyInput.on("paste", (event) => {
    const text = new TextDecoder().decode(event.bytes);
    if (dashboard.layer().kind === "agent") {
      if (view.composer.paste(text)) event.preventDefault();
      return;
    }
    event.preventDefault();
    feed(textKeys(text));
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
