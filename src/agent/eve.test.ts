import { expect, mock, test } from "bun:test";
import type { AgentChoice } from "../auth";
import type { Snapshot } from "../jira/client";
import { initialQuery } from "../jira/query";
import { deferred, snapshot } from "../testing";
import { EveAgent } from "./eve";

test("changing Agent settings discards a question still waiting for Jira", async () => {
  const reply = deferred<Snapshot>();
  const remember = mock(() => {});
  const original: AgentChoice = { provider: "openai", model: "test-model", reasoning: "medium" };
  const next: AgentChoice = { ...original, reasoning: "high" };
  const agent = EveAgent.create(
    { snapshot: () => reply.promise },
    {
      read: () => original,
      key: () => "fixture",
      remember,
    },
  );
  if (!agent) throw new Error("Expected a configured Agent");
  const onIssues = mock(() => {
    throw new Error("The stale question reached the conversation");
  });
  const request = agent.ask({
    scope: { sprint: 25, label: "Sprint 25" },
    thread: "thread",
    prompt: "What changed?",
    signal: new AbortController().signal,
    history: [],
    onIssues,
    onText: () => {},
  });
  const changed = agent.use(next);
  expect(agent.current).toEqual(next);
  await changed;
  reply.resolve(snapshot({ ...initialQuery, sprint: 25 }, ["EX-1"]));
  await expect(request).rejects.toThrow("Agent settings changed");
  expect(remember).toHaveBeenCalledWith(next);
  expect(onIssues).not.toHaveBeenCalled();
});
