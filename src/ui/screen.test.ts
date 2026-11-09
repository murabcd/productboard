import { afterEach, describe, expect, mock, test } from "bun:test";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { initialQuery, View } from "../jira/query";
import { Workspace } from "../state/workspace";
import { deferred, settle, snapshot } from "../testing";
import { Dashboard } from "./dashboard";
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

async function start() {
  const source = {
    snapshot: mock(() => deferred<never>().promise),
    catalog: mock(() => deferred<never>().promise),
    sprints: mock(() => deferred<never>().promise),
  };
  const work = new Workspace(source);
  work.query = { ...initialQuery, view: View.All };
  work.snapshot = snapshot(work.query, ["EX-1", "EX-2"]);
  const client = {
    site: "example.atlassian.net",
    detail: mock(() => deferred<never>().promise),
    attachment: mock(() => deferred<never>().promise),
  };
  const dashboard = new Dashboard(work, client, { open: async () => {}, copy: async () => {} }, () => {});
  setup = await createTestRenderer({ width: 100, height: 30 });
  const quit = mock(() => {});
  mount(setup.renderer, dashboard, quit);
  await setup.renderOnce();
  return { setup, dashboard, quit };
}

describe("OpenTUI shell", () => {
  test("draws the list and moves the selection with keys", async () => {
    const { setup, dashboard } = await start();
    expect(setup.captureCharFrame()).toContain("› EX-1");
    await setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(dashboard.selected()?.key).toBe("EX-2");
    expect(setup.captureCharFrame()).toContain("› EX-2");
  });

  test("clicking a row selects it and the wheel moves the selection", async () => {
    const { setup, dashboard } = await start();
    await setup.mockMouse.click(10, 8); // EX-2's row
    await setup.renderOnce();
    expect(dashboard.selected()?.key).toBe("EX-2");
    await setup.mockMouse.scroll(10, 8, "up");
    await setup.renderOnce();
    expect(dashboard.selected()?.key).toBe("EX-1");
    await setup.mockMouse.click(40, 1); // the "3 Assigned" tab
    expect(dashboard.workspace.query.view).toBe(View.Mine);
  });

  test("search typing and pasting go to the search box", async () => {
    const { setup, dashboard } = await start();
    await setup.mockInput.typeText("/ex");
    await settle();
    expect(dashboard.search).toBe("ex");
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
    expect([shown?.x, shown?.y]).toEqual([2, 9]);
    expect(setup.captureCharFrame()).toContain("dot.png");
    dashboard.preview = null;
    await setup.renderOnce();
    expect(shown?.visible).toBe(false);
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
