import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RGBA, TextareaRenderable } from "@opentui/core";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import type { AgentBackend } from "../agent/chat";
import { draftText } from "../agent/draft";
import { toDoc } from "../jira/adf";
import type { JiraClient } from "../jira/client";
import { toIssue } from "../jira/parse";
import { initialQuery, View } from "../jira/query";
import type { Issue } from "../jira/types";
import { Workspace } from "../state/workspace";
import { deferred, fakeAgent, issues, rawIssue, settle, snapshot } from "../testing";
import { Dashboard, type DashboardOptions } from "./dashboard";
import { MIN_WIDTH } from "./layout";
import { useRenderer } from "./screen";
import { toKeys } from "./terminal-input";

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

async function start(
  width = 100,
  {
    reads,
    ...options
  }: DashboardOptions & {
    reads?: Partial<Pick<JiraClient, "detail" | "attachment" | "findIssues">>;
  } = {},
) {
  const work = new Workspace({
    snapshot: mock(() => deferred<never>().promise),
    catalog: mock(() => deferred<never>().promise),
    sprints: mock(() => deferred<never>().promise),
  });
  work.query = { ...initialQuery, view: View.All };
  work.snapshot = snapshot(work.query, ["EX-1", "EX-2"]);
  const client = {
    site: "example.atlassian.net",
    detail: mock(() => deferred<never>().promise),
    attachment: mock(() => deferred<never>().promise),
    findIssues: mock(async () => []),
    ...reads,
  };
  const dashboard = new Dashboard(work, client, { open: async () => {}, copy: async () => {} }, () => {}, options);
  setup = await createTestRenderer({ width, height: 30, exitOnCtrlC: false });
  const quit = mock(() => {});
  const screen = useRenderer(setup.renderer, async () => {});
  void screen.show(dashboard).then(quit);
  await setup.renderOnce();
  return { setup, dashboard, quit, screen };
}

async function clickSidebar(setup: TestRendererSetup, name: string): Promise<void> {
  const row = setup
    .captureCharFrame()
    .split("\n")
    .findIndex((line) => {
      const divider = line.indexOf("│");
      return divider >= 0 && line.slice(0, divider).trimEnd().endsWith(` ${name}`);
    });
  expect(row).toBeGreaterThanOrEqual(0);
  await setup.mockMouse.click(6, row);
}

describe("OpenTUI shell", () => {
  test("connection prompts mask pasted keys and allow retry after rejection", async () => {
    setup = await createTestRenderer({ width: 100, height: 30 });
    const open = mock(async () => {});
    const screen = useRenderer(setup.renderer, open);
    const first = deferred<boolean>();
    const submit = mock((value: string) => (value === "test-rejected" ? first.promise : true));
    const prompt = screen.prompt(
      {
        title: "Connect OpenAI",
        field: { label: "API key", secret: true, url: "https://example.com/keys", submit },
      },
      "productboard",
    );
    setup.mockInput.pressKey("o", { ctrl: true });
    expect(open).toHaveBeenCalledWith("https://example.com/keys");
    await setup.mockInput.pasteBracketedText("test-rejected");
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame.split("\n")[8]).toContain("Connect OpenAI");
    expect(frame).toContain("submit enter");
    expect(frame).toContain("••••");
    expect(frame).not.toContain("test-rejected");

    setup.resize(35, 11);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Enlarge the terminal");
    await setup.mockInput.pasteBracketedText("ignored");
    setup.mockInput.pressEnter();
    expect(submit).not.toHaveBeenCalled();
    setup.resize(100, 30);
    await setup.renderOnce();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Connecting…");
    first.reject(new Error("Check your API key."));
    await settle();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Check your API key.");
    await setup.mockInput.typeText("test-accepted");
    setup.mockInput.pressEnter();
    expect(await prompt).toBe(true);
    expect(submit.mock.calls.map(([value]) => value)).toEqual(["test-rejected", "test-accepted"]);
    expect(setup.renderer.root.getRenderable("setup")).toBeUndefined();
  });

  test("Connect Agent accepts a provider without sending setup input to the dashboard", async () => {
    const backend = fakeAgent(async () => {});
    const close = mock(backend.close);
    backend.close = close;
    const connectAgent = mock(async () => {
      const provider = await screen.prompt(
        {
          title: "Connect an integration",
          choices: [
            { value: "openai", label: "OpenAI", detail: "API key" },
            { value: "anthropic", label: "Anthropic", detail: "API key" },
          ],
        },
        dashboard.theme,
      );
      return provider === "anthropic" ? backend : undefined;
    });
    const { setup, screen, dashboard } = await start(100, { connectAgent });
    await clickSidebar(setup, "Agent");
    await setup.renderOnce();
    await setup.mockInput.typeText("Keep this draft");
    const wordmark = () => setup.captureSpans().lines[0]?.spans.find((span) => span.text.includes("PRODUCT"))?.fg;
    const visible = wordmark();
    setup.mockInput.pressKey("k", { ctrl: true });
    await setup.renderOnce();
    const commands = setup.captureCharFrame().split("\n")[8];
    expect(commands).toContain("Commands");
    await setup.mockInput.typeText("Connect Agent");
    setup.mockInput.pressEnter();
    const frame = await setup.waitForFrame(
      (frame) => frame.includes("Connect an integration") && frame.includes("Keep this draft"),
    );
    const header = frame.split("\n")[8];
    expect(header).toContain("Connect an integration");
    expect(header?.indexOf("Connect an integration")).toBe(commands?.indexOf("Commands"));
    expect(header?.indexOf("esc")).toBe(commands?.indexOf("esc"));
    expect(frame).toContain("Search▏");
    expect(frame).toContain("PRODUCTBOARD");
    expect(frame).toContain("Keep this draft");
    const dimmed = wordmark();
    if (!visible || !dimmed) throw new Error("Expected the wordmark behind the prompt");
    expect(dimmed.r).toBeLessThan(visible.r);
    await clickSidebar(setup, "Inbox");
    expect(dashboard.agent.tab).toBe(true);
    await setup.mockInput.typeText("api key");
    await setup.renderOnce();
    const rows = setup.captureCharFrame().split("\n");
    const providerRow = rows.find((row) => row.includes("Anthropic"));
    if (!providerRow) throw new Error("Expected Anthropic in the provider picker");
    await setup.mockMouse.click(providerRow.indexOf("Anthropic"), rows.indexOf(providerRow));
    await settle();
    expect(dashboard.agent.chat.backend).toBe(backend);
    expect(draftText(dashboard.agent.chat.current.draft.parts)).toBe("Keep this draft");
    await setup.renderOnce();
    const composer = setup.renderer.root.getRenderable("dashboard")?.getRenderable("composer");
    expect(composer).toBeInstanceOf(TextareaRenderable);
    if (composer instanceof TextareaRenderable) expect(composer.placeholder).toBe("Message Agent… (@ for context)");
    await dashboard.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("the theme command recolors the screen and the focused Agent composer", async () => {
    const rememberTheme = mock(() => {});
    const { setup, dashboard } = await start(100, { appearance: { initial: "vercel-dark", save: rememberTheme } });
    const selectedBackground = () =>
      setup
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes("EX-1"))?.bg;
    expect(selectedBackground()?.equals(RGBA.fromHex("#2e2e2e"))).toBe(true);

    await clickSidebar(setup, "Agent");
    await setup.renderOnce();
    await setup.mockInput.typeText("Draft");
    setup.mockInput.pressKey("k", { ctrl: true });
    await setup.mockInput.typeText("change theme");
    setup.mockInput.pressEnter();
    expect(dashboard.picker?.selected?.value).toBe("vercel-dark");
    await setup.mockInput.typeText("vercel light");
    setup.mockInput.pressEnter();
    await setup.renderOnce();

    expect(rememberTheme).toHaveBeenCalledWith("vercel-light");
    expect(draftText(dashboard.agent.chat.current.draft.parts)).toBe("Draft");
    const composer = setup.renderer.root.getRenderable("dashboard")?.getRenderable("composer");
    if (!(composer instanceof TextareaRenderable)) throw new Error("Expected the Agent composer");
    expect(composer.visible).toBe(true);
    expect(composer.textColor.equals(RGBA.fromHex("#24292f"))).toBe(true);
    expect(composer.selectionBg?.equals(RGBA.fromHex("#dce3ec"))).toBe(true);
    await clickSidebar(setup, "All issues");
    await setup.renderOnce();
    expect(selectedBackground()?.equals(RGBA.fromHex("#dce3ec"))).toBe(true);
  });

  test("Agent shows when a theme could not be saved", async () => {
    const { setup, dashboard } = await start(80, {
      appearance: {
        save: () => {
          throw new Error("Preferences are unavailable");
        },
      },
    });
    try {
      await setup.mockInput.typeText("2");
      await setup.renderOnce();
      setup.mockInput.pressKey("k", { ctrl: true });
      await setup.mockInput.typeText("change theme");
      setup.mockInput.pressEnter();
      await setup.mockInput.typeText("vercel light");
      setup.mockInput.pressEnter();
      await setup.renderOnce();

      expect(dashboard.theme).toBe("vercel-light");
      expect(setup.captureCharFrame()).toContain("Could not save theme: Preferences are unavailable");
    } finally {
      dashboard.dispose();
    }
  });

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
    await clickSidebar(setup, "My issues");
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

  test("shift arrows scroll a long peek while plain arrows select issues", async () => {
    const description = toDoc("Issue details. ".repeat(150));
    const { setup, dashboard } = await start(130, {
      reads: { detail: async () => ({ description, facts: [], comments: [], attachments: [] }) },
    });
    await setup.mockInput.typeText(" ");
    await settle();
    await setup.renderOnce();

    await setup.mockInput.pressArrow("down", { shift: true });
    await setup.renderOnce();
    expect(dashboard.peek?.scroll).toBeGreaterThan(0);
    expect(dashboard.list.selected?.key).toBe("EX-1");
    const rows = setup.captureCharFrame().trimEnd().split("\n");
    expect(rows.at(-1)).toContain("Scroll peek");
    expect(rows.at(-2)?.replace("│", "").trim()).toBe("");

    await setup.mockInput.pressArrow("up", { shift: true });
    await setup.renderOnce();
    expect(dashboard.peek?.scroll).toBe(0);

    await setup.mockInput.pressArrow("down");
    expect(dashboard.list.selected?.key).toBe("EX-2");

    await setup.mockInput.typeText(" ");
    await setup.mockInput.pressArrow("up", { shift: true });
    expect(dashboard.list.selected?.key).toBe("EX-1");
  });

  test("search typing and pasting go to the search box", async () => {
    const { setup, dashboard } = await start();
    await setup.mockInput.typeText("/ex");
    await settle();
    expect(dashboard.list.search).toBe("ex");
  });

  test("the last tab stays visible and clickable at the minimum pane width", async () => {
    const { setup, dashboard } = await start(MIN_WIDTH);
    await setup.mockInput.typeText("3");
    expect(dashboard.workspace.query.view).toBe(View.Mentions);
    await setup.renderOnce();
    const allIssues = setup.captureCharFrame().split("\n")[1]?.indexOf(" All ") ?? -1;
    expect(allIssues).toBeGreaterThan(0);
    await setup.mockMouse.click(allIssues + 1, 1);
    expect(dashboard.workspace.query.view).toBe(View.All);
  });

  test("i previews a single image directly and Escape hides it", async () => {
    const image = { id: "1", filename: "dot.png", mimeType: "image/png", size: 70, author: "D", created: "" };
    const { setup } = await start(100, {
      reads: {
        detail: async () => ({ attachments: [image], description: [], comments: [], facts: [] }),
        attachment: async () => PNG,
      },
    });
    await setup.mockInput.pressEnter();
    await settle();
    await setup.mockInput.typeText("i");
    await settle();
    await setup.renderOnce();
    await setup.renderOnce();
    const view = setup.renderer.root.getRenderable("dashboard");
    const shown = view?.getRenderable("preview");
    expect(shown?.visible).toBe(true);
    expect([shown?.x, shown?.y]).toEqual([22, 8]);
    expect(setup.captureCharFrame()).toContain("dot.png");
    setup.mockInput.pressEscape();
    await Bun.sleep(30);
    await setup.renderOnce();
    expect(shown?.visible).toBe(false);
  });

  test("Agent answers without a selected sprint and opens an issue cited from Jira", async () => {
    const finish = deferred<void>();
    const ask = mock<AgentBackend["ask"]>(async ({ onIssues, onText }) => {
      onText("Review ");
      await finish.promise;
      onIssues(snapshot({ ...initialQuery, view: View.All }, ["EX-1"]).issues);
      onText("EX-1 before release.");
    });
    const { setup, dashboard } = await start(100, { agent: fakeAgent(ask) });
    await clickSidebar(setup, "Agent");
    await setup.mockInput.typeText("Any risks?");
    await setup.mockInput.pressEnter();
    await settle();
    await setup.renderOnce();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(setup.captureCharFrame()).toContain("Review");
    finish.resolve();
    await settle();
    await setup.renderOnce();
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

  test("Agent pages by the visible transcript rows as the composer grows and the pane resizes", async () => {
    const answer = Array.from({ length: 60 }, (_, index) => `Transcript row ${index + 1}`).join("\n");
    const ask: AgentBackend["ask"] = async ({ onText }) => onText(`\`\`\`\n${answer}\n\`\`\``);
    const { setup } = await start(100, { agent: fakeAgent(ask) });
    await clickSidebar(setup, "Agent");
    await setup.renderOnce();
    await setup.mockInput.typeText("Show a long reply");
    await setup.mockInput.pressEnter();
    await settle();

    for (let line = 0; line < 5; line++) setup.mockInput.pressKey("j", { ctrl: true });
    await setup.mockInput.typeText("Draft");
    const visible = () =>
      Array.from(setup.captureCharFrame().matchAll(/Transcript row (\d+)/g), (match) => Number(match[1]));
    for (const height of [30, 25]) {
      setup.resize(100, height);
      await setup.renderOnce();
      await setup.renderOnce();
      const latest = visible();
      expect(latest.at(-1)).toBe(60);
      setup.mockInput.pressKey("\x1b[5~");
      await setup.renderOnce();
      expect(visible().at(-1)).toBe((latest[0] ?? 0) - 1);
      setup.mockInput.pressKey("\x1b[6~");
      await setup.renderOnce();
      expect(visible()).toEqual(latest);
    }
  });

  test("Agent sends the contents of inline tokens and the selected sprint", async () => {
    const ask = mock<AgentBackend["ask"]>(async ({ onText }) => onText("Got it."));
    const { setup, dashboard } = await start(100, { agent: fakeAgent(ask) });
    const directory = await mkdtemp(join(tmpdir(), "productboard-image-"));
    const filename = "Sprint screenshot.png";
    const path = join(directory, filename);
    try {
      await Bun.write(path, PNG);
      dashboard.workspace.board = "1";
      dashboard.workspace.sprints = [
        { id: 31, name: "Web - Sprint 31", state: "active", start: "", end: "", goal: "" },
        { id: 32, name: "Web - Sprint 32 結果", state: "closed", start: "", end: "", goal: "" },
      ];
      await clickSidebar(setup, "Agent");
      await setup.renderOnce();
      await setup.mockInput.pasteBracketedText("Compare 🧪 結果: ");
      await setup.mockInput.typeText("@");
      expect(dashboard.picker?.kind).toBe("agent-context");
      await setup.mockInput.typeText("sprint 32");
      setup.mockInput.pressEnter();
      await setup.renderOnce();
      expect(draftText(dashboard.agent.chat.current.draft.parts)).toBe("Compare 🧪 結果: @Sprint 32 結果");
      setup.mockInput.pressBackspace();
      await settle();
      expect(draftText(dashboard.agent.chat.current.draft.parts)).toBe("Compare 🧪 結果: ");

      await setup.mockInput.typeText("@sprint 32");
      setup.mockInput.pressEnter();
      await setup.renderOnce();
      setup.mockInput.pressKey("k", { ctrl: true });
      await setup.mockInput.typeText("add context");
      setup.mockInput.pressEnter();
      await setup.mockInput.typeText("sprint 31");
      setup.mockInput.pressEnter();
      await setup.renderOnce();
      expect(draftText(dashboard.agent.chat.current.draft.parts)).toBe("Compare 🧪 結果: @Sprint 31");
      await setup.mockInput.pasteBracketedText(path.replaceAll(" ", "\\ "));
      for (let attempt = 0; attempt < 50 && dashboard.agent.chat.current.draft.loading; attempt++) {
        await Bun.sleep(5);
      }
      const pasted = "first $&\nsecond\nthird\nfourth\nfifth\nsixth  ";
      await setup.mockInput.pasteBracketedText(pasted);
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("Compare 🧪 結果: @Sprint 31 [Image #1] [Pasted text #2 +5 lines]");
      expect(setup.captureCharFrame()).not.toContain(filename);
      await setup.mockInput.pasteBracketedText("remove me\nplease");
      setup.mockInput.pressBackspace();
      await settle();
      expect(draftText(dashboard.agent.chat.current.draft.parts)).toEndWith("[Pasted text #2 +5 lines]");

      await setup.mockInput.pasteBracketedText(join(directory, "missing.png"));
      for (let attempt = 0; attempt < 50 && !dashboard.agent.chat.current.draft.error; attempt++) {
        await Bun.sleep(5);
      }
      expect(dashboard.agent.chat.current.draft.error).toBe("Could not read the image.");
      await setup.mockInput.typeText(" — explain");
      setup.mockInput.pressEnter();
      await settle();
      expect(ask.mock.calls[0]?.[0]).toMatchObject({
        prompt: `Compare 🧪 結果: ${pasted} — explain`,
        sprint: { id: 31, name: "Web - Sprint 31" },
        images: [{ filename, mediaType: "image/png", bytes: Buffer.from(PNG) }],
      });
      expect(dashboard.workspace.query.view).toBe(View.All);
      await setup.renderOnce();
      await setup.mockInput.pasteBracketedText("And across Jira?");
      setup.mockInput.pressEnter();
      await settle();
      expect(ask.mock.calls[1]?.[0]).toMatchObject({ prompt: "And across Jira?", sprint: undefined, images: [] });
    } finally {
      await unlink(path);
      await rmdir(directory);
    }
  });

  test("Agent context searches across Jira and attaches a task without changing the workspace", async () => {
    const ask = mock<AgentBackend["ask"]>(async () => {});
    const firstRequest = deferred<AbortSignal>();
    const secondRequest = deferred<void>();
    const stale = deferred<Issue[]>();
    const { setup, dashboard } = await start(100, {
      agent: fakeAgent(ask),
      reads: {
        findIssues: async (text, signal) => {
          if (text === "reindex") {
            firstRequest.resolve(signal);
            return stale.promise;
          }
          expect(text).toBe("incident");
          secondRequest.resolve();
          return issues("OPS-91");
        },
      },
    });
    const local = Array.from({ length: 12 }, (_, index) => `EX-${index + 1}`);
    dashboard.workspace.snapshot = {
      ...snapshot(dashboard.workspace.query, local),
      issues: local.map((key) => toIssue(rawIssue(key, "new", { title: "Local incident" }))),
    };
    await clickSidebar(setup, "Agent");
    await setup.renderOnce();
    await setup.mockInput.typeText("Review @reindex");
    const signal = await firstRequest.promise;
    setup.mockInput.pressEscape();
    await Bun.sleep(30);
    await setup.renderOnce();
    expect(signal.aborted).toBe(true);

    await setup.mockInput.typeText("@incident");
    await secondRequest.promise;
    stale.resolve(issues("OLD-2"));
    await settle();
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("OPS-91");
    expect(frame).not.toContain("OLD-2");
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(draftText(dashboard.agent.chat.current.draft.parts)).toBe("Review @OPS-91");

    setup.mockInput.pressEnter();
    await settle();
    expect(ask.mock.calls[0]?.[0]).toMatchObject({
      prompt: expect.stringMatching(/^Review +OPS-91$/),
      sprint: undefined,
    });
    expect(dashboard.workspace.query.view).toBe(View.All);
    expect(dashboard.workspace.issues.map(({ key }) => key)).toEqual(local);
  });

  test("the Agent box takes all typing, grows with lines, sends on Enter; Esc interrupts", async () => {
    const ask = mock<AgentBackend["ask"]>(
      ({ signal }) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
    );
    const { setup, dashboard, quit } = await start(100, { agent: fakeAgent(ask) });
    await clickSidebar(setup, "Agent");
    await setup.renderOnce();
    await setup.mockInput.typeText("quick 1 line"); // q and 1 are text here, not keys
    setup.mockInput.pressKey("j", { ctrl: true });
    await setup.mockInput.typeText("second line");
    await setup.renderOnce();
    expect(quit).not.toHaveBeenCalled();
    expect(draftText(dashboard.agent.chat.current.draft.parts)).toBe("quick 1 line\nsecond line");
    expect(dashboard.agent.composerRows).toBe(2);
    setup.mockInput.pressEnter();
    await settle();
    await setup.renderOnce();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(draftText(dashboard.agent.chat.current.draft.parts)).toBe("");
    expect(setup.captureCharFrame()).toContain("esc interrupt");
    setup.mockInput.pressEscape();
    await Bun.sleep(30); // a lone Esc is recognized after a short wait
    await settle();
    expect(dashboard.agent.chat.current.pending).toBeUndefined();
    expect(dashboard.agent.tab).toBe(true); // the first Esc only interrupts
  });

  test("the command palette opens over Agent from the shortcut and top bar", async () => {
    const { setup, dashboard } = await start();
    await clickSidebar(setup, "Agent");
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
      expect(draftText(dashboard.agent.chat.current.draft.parts)).toEndWith("resumed");
      dashboard.agent.chat.current.draft.replace([]);
      await setup.renderOnce();
    }
  });

  test("q quits from the minimum-size screen when Agent was active", async () => {
    const { setup, quit } = await start();
    await clickSidebar(setup, "Agent");
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
