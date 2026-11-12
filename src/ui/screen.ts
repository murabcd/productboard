import {
  type CliRenderer,
  createCliRenderer,
  ImageRenderable,
  type KeyEvent,
  type OptimizedBuffer,
  type PasteEvent,
  Renderable,
} from "@opentui/core";
import type { ThemeId } from "../theme";
import { SCANNER_FRAME_MS } from "./agent";
import type { Canvas, Rect } from "./canvas";
import { AgentComposer } from "./composer";
import type { Dashboard } from "./dashboard";
import { frame } from "./frame";
import type { Key, KeyName } from "./input";
import { COMPOSER_MAX_ROWS } from "./layout";
import { type SetupPrompt, SetupView } from "./setup";
import { textKeys, toKeys } from "./terminal-input";
import { drawCanvas, resolveTheme } from "./theme";

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
const COMPLETION_KEYS = new Set<KeyName>(["up", "down", "pageup", "pagedown", "enter", "tab", "escape", "ctrl-c"]);

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
    private readonly quit: () => void,
    private readonly hasPrompt: () => boolean,
  ) {
    super(renderer, {
      id: "dashboard",
      width: "100%",
      height: "100%",
      onMouseDown: (event) => {
        if (event.button !== 0) return;
        const target = this.canvas?.targetAt(event.x, event.y);
        if (target || dashboard.composerMenu) this.dispatch(() => dashboard.click(target));
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
      this.syncContext();
      if (dashboard.layer().kind === "agent") {
        dashboard.setCommandQuery(this.composer.commandQuery, () => this.composer.clearCommand());
      }
      this.fitComposer();
      this.requestRender();
    });
    this.add(this.image);
    this.add(this.composer);
  }

  key(event: KeyEvent): void {
    const keys = toKeys(event);
    const editing = this.dashboard.layer().kind === "agent";
    if (editing) {
      this.composer.sync();
      this.syncContext();
      const [key] = keys;
      const plain = !event.ctrl && !event.shift && !event.meta && !event.super;
      const completion = this.dashboard.completionMenu;
      if (completion && key && "name" in key && COMPLETION_KEYS.has(key.name) && (plain || key.name === "ctrl-c")) {
        event.preventDefault();
        this.dispatch(() => this.dashboard.handleCompletion(key));
        return;
      }
      if (!completion && event.sequence === "@" && this.composer.canMention()) {
        event.preventDefault();
        this.dispatch(() => this.dashboard.openPicker("agent-context"));
        return;
      }
    }
    const dashboardKeys = editing ? keys.filter((key) => "name" in key && COMPOSER_KEYS.has(key.name)) : keys;
    if (dashboardKeys.length === 0) return;
    event.preventDefault();
    this.feed(dashboardKeys);
  }

  paste(event: PasteEvent): void {
    const text = new TextDecoder().decode(event.bytes);
    if (this.dashboard.layer().kind === "agent") {
      if (this.composer.paste(text)) {
        event.preventDefault();
        this.dashboard.setContextQuery(undefined);
        this.syncContext();
      }
      return;
    }
    event.preventDefault();
    this.feed(textKeys(text));
  }

  private feed(keys: Key[]): void {
    this.dispatch(() => {
      for (const key of keys) {
        if (!this.dashboard.handle(key)) {
          this.quit();
          break;
        }
      }
    });
  }

  private dispatch(action: () => void): void {
    const before = this.dashboard.contextMenu;
    action();
    const reference = this.dashboard.contextPicker.takeReference();
    const menu = this.dashboard.contextMenu;
    if (reference) this.composer.attachReference(reference);
    else if (menu && menu !== before) this.composer.startMention();
    this.syncContext();
    this.requestRender();
  }

  private syncContext(): void {
    this.dashboard.setContextQuery(this.composer.mentionQuery);
    if (!this.dashboard.contextMenu) this.composer.clearMention();
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const { width, height } = buffer;
    if (this.theme.id !== this.dashboard.theme) {
      this.theme = resolveTheme(this.dashboard.theme);
      this.renderer.setBackgroundColor(this.theme.surfaces.workspace);
      Object.assign(this.composer, this.theme.composer);
    }
    this.dashboard.resize(width, height);
    const editing = this.dashboard.layer().kind === "agent";
    if (editing) {
      this.composer.sync();
      this.syncContext();
      if (this.composer.visible) this.fitComposer();
    }
    const canvas = frame(this.dashboard);
    this.canvas = canvas;
    drawCanvas(buffer, canvas, this.theme);
    const covered = this.hasPrompt();
    this.placeImage(covered ? undefined : canvas.reserved("image"));
    this.placeComposer(canvas.reserved("composer"), !covered && editing);
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

  private placeComposer(area: Rect | undefined, focused: boolean): void {
    const shown = this.place(this.composer, area);
    if (shown && focused) this.composer.focus();
    else this.composer.blur();
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

export interface Screen {
  redraw(): void;
  show(dashboard: Dashboard): Promise<void>;
  prompt<Result>(request: SetupPrompt<Result>, theme: ThemeId): Promise<Result | undefined>;
  /** Restore the terminal. Safe to call more than once. */
  close(): Promise<void>;
}

/** Take over the terminal; call `close` when done, even after an error. */
export async function openScreen(open: (url: string) => Promise<void>): Promise<Screen> {
  const renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    exitOnCtrlC: false,
    useMouse: true,
    targetFps: 30,
  });
  renderer.setTerminalTitle("ProductBoard");
  return useRenderer(renderer, open);
}

export function useRenderer(renderer: CliRenderer, open: (url: string) => Promise<void>): Screen {
  let dashboard: DashboardView | undefined;
  let prompt: (Pick<SetupView<unknown>, "key" | "paste"> & { dismiss(): void }) | undefined;
  renderer.keyInput.on("keypress", (event) => (prompt ?? dashboard)?.key(event));
  renderer.keyInput.on("paste", (event) => (prompt ?? dashboard)?.paste(event));
  return {
    redraw: () => renderer.requestRender(),
    show: (model) =>
      new Promise<void>((resolve) => {
        dashboard = new DashboardView(renderer, model, resolve, () => prompt !== undefined);
        renderer.root.add(dashboard);
        renderer.requestRender();
      }),
    prompt: (request, theme) =>
      new Promise((resolve) => {
        if (prompt) throw new Error("A connection prompt is already open.");
        const view = new SetupView(renderer, theme, request, open, (value) => {
          prompt = undefined;
          view.destroyRecursively();
          renderer.requestRender();
          resolve(value);
        });
        prompt = view;
        if (!dashboard) renderer.setBackgroundColor(resolveTheme(theme).surfaces.workspace);
        renderer.root.add(view);
        renderer.requestRender();
      }),
    close: async () => {
      prompt?.dismiss();
      if (!renderer.isDestroyed) renderer.destroy();
      await renderer.closed;
    },
  };
}
