import { afterEach, describe, expect, mock, test } from "bun:test";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import type { AgentBackend } from "../agent/chat";
import { initialQuery, View } from "../jira/query";
import { Workspace } from "../state/workspace";
import { deferred, fakeAgent, settle, snapshot } from "../testing";
import { Dashboard } from "./dashboard";
import { MIN_WIDTH } from "./layout";
import { mount, toKeys } from "./screen";

/** A 1×1 red PNG. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

let setup: TestRendererSetup | undefined;
afterEach(async () => {
  await setup?.dispose();
  setup = undefined;
});

async function start(width = 100, agent?: AgentBackend) {
  const source = {
    snapshot: mock(() => deferred<never>().promise),
    catalog: mock(() => deferred<never>().promise),
    sprints: mock(() => deferred<never>().promise),
  };
  const work = new Workspace(source);
  work.query = { ...initialQuery, view: View.All, sprint: agent ? 25 : null };
  work.snapshot = snapshot(work.query, ["EX-1", "EX-2"]);
  const client = {
    site: "example.atlassian.net",
    detail: mock(() => deferred<never>().promise),
    attachment: mock(() => deferred<never>().promise),
  };
  const dashboard = new Dashboard(work, client, { open: async () => {}, copy: async () => {} }, () => {}, agent);
  setup = await createTestRenderer({ width, height: 30, exitOnCtrlC: false });
  const quit = mock(() => {});
  mount(setup.renderer, dashboard, quit);
  await setup.renderOnce();
  return { setup, dashboard, quit };
}

describe("OpenTUI shell", () => {
  test("draws the list and moves the selection with keys", async () => {
    const { setup, dashboard } = await start();
    expect(setup.captureCharFrame()).toMatch(/› EX-1/);
    await setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(dashboard.list.selected?.key).toBe("EX-2");
    expect(setup.captureCharFrame()).toMatch(/› EX-2/);
  });

  test("clicking a row selects it and the wheel moves the selection", async () => {
    const { setup, dashboard } = await start();
    await setup.mockMouse.click(30, 8); // EX-2's row
    await setup.renderOnce();
    expect(dashboard.list.selected?.key).toBe("EX-2");
    await setup.mockMouse.scroll(30, 8, "up");
    await setup.renderOnce();
    expect(dashboard.list.selected?.key).toBe("EX-1");
    await setup.mockMouse.click(6, 3); // My issues in the sidebar
    expect(dashboard.workspace.query.view).toBe(View.Mine);
  });

  test("the wheel over the peek scrolls the peek, not the list", async () => {
    const { setup, dashboard } = await start(130);
    await setup.mockInput.typeText(" ");
    await setup.renderOnce();
    expect(dashboard.peek?.issue.key).toBe("EX-1");
    await setup.mockMouse.scroll(120, 12, "down"); // inside the peek panel
    await setup.renderOnce();
    expect(dashboard.list.selected?.key).toBe("EX-1");
    await setup.mockMouse.scroll(40, 7, "down"); // over the list
    await setup.renderOnce();
    expect(dashboard.list.selected?.key).toBe("EX-2");
  });

  test("search typing and pasting go to the search box", async () => {
    const { setup, dashboard } = await start();
    await setup.mockInput.typeText("/ex");
    await settle();
    expect(dashboard.list.search).toBe("ex");
  });

  test("the last tab stays visible and clickable at the minimum pane width", async () => {
    const { setup, dashboard } = await start(MIN_WIDTH);
    const search = setup.captureCharFrame().split("\n")[0]?.indexOf("Find") ?? -1;
    expect(search).toBeGreaterThan(0);
    await setup.mockMouse.click(search, 0);
    expect(dashboard.workspace.query.view).toBe(View.Search);
  });

  test("a previewed image is shown in its area and hidden afterwards", async () => {
    const { setup, dashboard } = await start();
    const image = { id: "1", filename: "dot.png", mimeType: "image/png", size: 70, author: "D", created: "" };
    dashboard.preview = { images: [image], index: 0, bytes: PNG, loading: false, error: "" };
    await setup.renderOnce();
    await setup.renderOnce();
    const view = setup.renderer.root.getRenderable("dashboard");
    const shown = view?.getRenderable("preview");
    expect(shown?.visible).toBe(true);
    expect([shown?.x, shown?.y]).toEqual([22, 8]);
    expect(setup.captureCharFrame()).toContain("dot.png");
    dashboard.preview = null;
    await setup.renderOnce();
    expect(shown?.visible).toBe(false);
  });

  test("Agent answers about the sprint, and a cited issue opens and closes back to Agent", async () => {
    const ask = mock<AgentBackend["ask"]>(async ({ onIssues, onText, scope }) => {
      onIssues(snapshot({ ...initialQuery, sprint: scope.sprint }, ["EX-1"]).issues);
      onText("Review EX-1 before release.");
    });
    const { setup, dashboard } = await start(100, fakeAgent(ask));
    await setup.mockMouse.click(6, 4); // Agent in the sidebar
    await setup.mockInput.typeText("Any risks?");
    await setup.mockInput.pressEnter();
    await settle();
    await setup.renderOnce();
    expect(ask.mock.calls[0]?.[0].scope.sprint).toBe(25);
    const lines = setup.captureCharFrame().split("\n");
    const citation = lines.findIndex((line) => line.includes("Review EX-1"));
    expect(citation).toBeGreaterThan(0);
    await setup.mockMouse.click(lines[citation]?.indexOf("EX-1") ?? -1, citation);
    await setup.renderOnce();
    expect(dashboard.modal).toMatchObject({ kind: "issue", issue: { key: "EX-1" } });
    setup.mockInput.pressCtrlC();
    expect(dashboard.modal).toBeNull();
    expect(dashboard.agent.tab).toBe(true);
  });

  test("the Agent box takes all typing, grows with lines, sends on Enter; Esc interrupts", async () => {
    const ask = mock<AgentBackend["ask"]>(
      ({ signal }) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
    );
    const { setup, dashboard, quit } = await start(100, fakeAgent(ask));
    await setup.mockMouse.click(6, 4); // Agent in the sidebar
    await setup.renderOnce();
    await setup.mockInput.typeText("quick 1 line"); // q and 1 are text here, not keys
    setup.mockInput.pressKey("j", { ctrl: true });
    await setup.mockInput.typeText("second line");
    await setup.renderOnce();
    expect(quit).not.toHaveBeenCalled();
    expect(dashboard.agent.chat.current.draft).toBe("quick 1 line\nsecond line");
    expect(dashboard.agent.composerRows).toBe(2);
    setup.mockInput.pressEnter();
    await settle();
    await setup.renderOnce();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(dashboard.agent.chat.current.draft).toBe("");
    expect(setup.captureCharFrame()).toContain("esc interrupt");
    setup.mockInput.pressEscape();
    await Bun.sleep(30); // a lone Esc is recognized after a short wait
    await settle();
    expect(dashboard.agent.chat.current.pending).toBeUndefined();
    expect(dashboard.agent.tab).toBe(true); // the first Esc only interrupts
  });

  test("the command palette opens over Agent from the shortcut and top bar", async () => {
    const { setup, dashboard } = await start();
    await setup.mockMouse.click(6, 4);
    await setup.renderOnce();
    const command = setup.captureCharFrame().split("\n")[0]?.indexOf("^K") ?? -1;
    expect(command).toBeGreaterThan(0);
    for (const open of [() => setup.mockInput.pressKey("k", { ctrl: true }), () => setup.mockMouse.click(command, 0)]) {
      await open();
      await setup.renderOnce();
      expect(dashboard.picker?.kind).toBe("commands");
      expect(dashboard.agent.tab).toBe(true);
      setup.mockInput.pressEscape();
      await Bun.sleep(30);
      await setup.renderOnce();
      expect(dashboard.picker).toBeNull();
      await setup.mockInput.typeText("resumed");
      expect(dashboard.agent.chat.current.draft.endsWith("resumed")).toBe(true);
      dashboard.agent.chat.current.draft = "";
      await setup.renderOnce();
    }
  });

  test("q quits from the minimum-size screen when Agent was active", async () => {
    const { setup, quit } = await start();
    await setup.mockMouse.click(6, 4);
    await setup.renderOnce();
    setup.resize(MIN_WIDTH - 1, 15);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("q quit");
    await setup.mockInput.typeText("q");
    expect(quit).toHaveBeenCalledTimes(1);
  });

  test("q quits", async () => {
    const { setup, quit } = await start();
    await setup.mockInput.typeText("q");
    expect(quit).toHaveBeenCalled();
  });

  test("key mapping covers navigation and ignores modifier combos", () => {
    const key = (
      name: string,
      extra: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; sequence: string }> = {},
    ) => toKeys({ name, ctrl: false, meta: false, shift: false, sequence: name, ...extra });
    expect(key("pagedown")).toEqual([{ name: "pagedown" }]);
    expect(key("return")).toEqual([{ name: "enter" }]);
    expect(key("c", { ctrl: true })).toEqual([{ name: "ctrl-c" }]);
    expect(key("tab", { shift: true })).toEqual([]);
    expect(key("x", { meta: true })).toEqual([]);
    expect(key("ж", { sequence: "ж" })).toEqual([{ text: "ж" }]);
  });
});
