import { expect, mock, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { AgentBackend } from "../agent/chat";
import { Workspace } from "../state/workspace";
import { deferred, fakeAgent, issues, settle } from "../testing";
import { Dashboard } from "./dashboard";
import { frame } from "./frame";
import { useRenderer } from "./screen";

function start(backend: AgentBackend) {
  const never = () => deferred<never>().promise;
  const workspace = new Workspace({ snapshot: never, boards: never, projects: never, sprints: never });
  const copy = mock(async (_text: string) => {});
  const dashboard = new Dashboard(
    workspace,
    { site: "example.atlassian.net", detail: never, attachment: never, findIssues: never },
    { open: async () => {}, copy },
    () => {},
    { agent: backend },
  );
  dashboard.openAgent();
  return { dashboard, chat: dashboard.agent.chat, copy };
}

test("tool activity is reachable from keyboard search and its clickable transcript row", async () => {
  const { dashboard, chat } = start(
    fakeAgent(async ({ onText, onTools }) => {
      onText("Review EX-1.");
      onTools([
        {
          id: "search",
          name: "Search Jira",
          query: "project = EX",
          state: "completed",
          detail: "1 issue · more available",
          limit: 1,
          result: { kind: "jira-search", more: true, issues: issues("EX-1") },
        },
      ]);
    }),
  );
  try {
    chat.current.draft.replace(["Review"]);
    await chat.send();
    dashboard.openPicker("agent-tools");
    dashboard.picker?.setQuery("project = EX");
    dashboard.handle({ name: "enter" });
    expect(dashboard.modal).toMatchObject({ kind: "text", title: "Search Jira" });
    expect(JSON.stringify(dashboard.modal)).toContain("EX-1");
    expect(JSON.stringify(dashboard.modal)).toContain("More matches exist");
    dashboard.handle({ name: "escape" });
    const canvas = frame(dashboard);
    const row = Array.from({ length: dashboard.height }, (_, row) => row).find((row) =>
      canvas.text(row).includes("Search Jira"),
    );
    expect(row).toBeDefined();
    if (row === undefined) throw new Error("Missing tool row");
    const column = canvas.text(row).indexOf("Search Jira");
    const target = canvas.targetAt(column, row);
    expect(target?.kind).toBe("agent-tool");
    dashboard.click(target);
    expect(dashboard.modal).toMatchObject({ title: "Search Jira" });
  } finally {
    await dashboard.dispose();
  }
});

test("saved chat search finds pasted prompt contents beyond the visible token label", async () => {
  const { dashboard, chat } = start(fakeAgent(async ({ onText }) => onText("Answer")));
  try {
    chat.current.draft.replace([
      { kind: "paste", label: "[Pasted text #1]", text: "Investigate the unique Falcon rollout" },
    ]);
    await chat.send();
    const saved = chat.current.id;
    chat.start();
    dashboard.openPicker("chats");
    dashboard.picker?.setQuery("Falcon rollout");
    expect(dashboard.picker?.selected?.value).toBe(saved);
    dashboard.handle({ name: "enter" });
    expect(chat.current.id).toBe(saved);
  } finally {
    await dashboard.dispose();
  }
});

test("the native composer queues on Enter and sends now on Ctrl+Enter in a minimum pane", async () => {
  const pending = deferred<void>();
  const ask = mock<Parameters<typeof fakeAgent>[0]>(async ({ prompt, onText }) => {
    onText(`Reply ${prompt}`);
    if (prompt === "First") await pending.promise;
  });
  const { dashboard, chat } = start(fakeAgent(ask));
  dashboard.resize(60, 18);
  const setup = await createTestRenderer({ width: 60, height: 18, exitOnCtrlC: false, kittyKeyboard: true });
  const screen = useRenderer(setup.renderer, async () => {});
  void screen.show(dashboard);
  try {
    await setup.renderOnce();
    await setup.mockInput.typeText("First");
    setup.mockInput.pressEnter();
    await settle();
    await setup.renderOnce();
    await setup.mockInput.typeText("Later");
    setup.mockInput.pressEnter();
    await settle();
    await setup.renderOnce();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(chat.current.queue.length).toBe(1);
    expect(setup.captureCharFrame()).toContain("Queued follow-ups");
    expect(setup.captureCharFrame()).toContain("Edit");
    dashboard.agent.composerRows = 6;
    const layout = dashboard.agentLayout;
    expect(layout.transcript.top + layout.transcript.capacity).toBeLessThan(layout.queue.top);
    expect(layout.queue.top + layout.queue.rows).toBe(layout.boxTop);
    expect(layout.rows).toBeGreaterThan(0);
    await setup.mockInput.typeText("Now");
    setup.mockInput.pressEnter({ ctrl: true });
    await settle();
    await setup.renderOnce();
    expect(ask.mock.calls.map(([request]) => request.prompt)).toEqual(["First", "Now", "Later"]);
    expect(chat.current.turns[0]?.state.kind).toBe("interrupted");
    expect(chat.current.queue.length).toBe(0);
  } finally {
    pending.resolve();
    await dashboard.dispose();
    await setup.dispose();
  }
});

test("specific answers copy from keyboard search and forks isolate earlier turns and attachments", async () => {
  const { dashboard, chat, copy } = start(
    fakeAgent(async ({ prompt, onText, onIssues }) => {
      onText(`Answer to ${prompt}`);
      onIssues(issues("EX-1"));
    }),
  );
  try {
    const image = { filename: "old.png", mediaType: "image/png", bytes: new Uint8Array([1, 2, 3]) };
    chat.current.draft.restore({ parts: ["First", { kind: "image", label: "[Image]" }], images: [image] });
    await chat.send();
    chat.current.draft.replace(["Second"]);
    await chat.send();
    const original = chat.current;
    const first = original.turns[0];
    const last = original.turns[1];
    if (!first || !last) throw new Error("Expected replies");
    original.checkpoint = { through: last.id, summary: "Includes second reply", created: 0 };
    original.draft.replace(["Original draft"]);
    dashboard.openPicker("agent-answers");
    dashboard.picker?.setQuery("First");
    dashboard.handle({ name: "enter" });
    await settle();
    expect(copy).toHaveBeenLastCalledWith("Answer to First");
    dashboard.openPicker("agent-fork");
    dashboard.picker?.setQuery("First");
    dashboard.handle({ name: "enter" });
    expect(chat.current.id).not.toBe(original.id);
    expect(chat.current.turns).toHaveLength(1);
    expect(chat.current.checkpoint).toBeUndefined();
    expect(chat.current.turns[0]?.images[0]?.bytes).toEqual(image.bytes);
    expect(chat.current.issues.has("EX-1")).toBe(true);
    const forked = chat.current.turns[0];
    if (!forked) throw new Error("Expected forked reply");
    forked.answer = "Changed only in fork";
    expect(first.answer).toBe("Answer to First");
    expect(original.draft.parts).toEqual(["Original draft"]);
    expect(original.turns).toHaveLength(2);
    const canvas = frame(dashboard);
    const row = Array.from({ length: dashboard.height }, (_, row) => row).find((row) =>
      canvas.text(row).includes("Copy answer"),
    );
    expect(row).toBeDefined();
    if (row !== undefined)
      expect(canvas.targetAt(canvas.text(row).indexOf("Copy answer"), row)).toMatchObject({
        kind: "agent-message",
        action: "copy",
        turn: first.id,
      });
  } finally {
    await dashboard.dispose();
  }
});
