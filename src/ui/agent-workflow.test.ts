import { expect, mock, test } from "bun:test";
import type { AgentBackend } from "../agent/chat";
import { Workspace } from "../state/workspace";
import { deferred, fakeAgent, issues } from "../testing";
import { Dashboard } from "./dashboard";
import { frame } from "./frame";

function start(backend: AgentBackend) {
  const never = () => deferred<never>().promise;
  const workspace = new Workspace({ snapshot: never, catalog: never, sprints: never });
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
