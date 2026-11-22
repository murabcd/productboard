import { expect, mock, test } from "bun:test";
import { JiraSearchResult } from "../../agent/lib/jira-search";
import { issues } from "../testing";
import { EveStream } from "./eve-stream";

const coordinates = { turnId: "turn", stepIndex: 0, sequence: 0 };
const meta = () => ({ id: crypto.randomUUID(), at: new Date().toISOString() });

test("Eve's authoritative completion replaces provisional text and keeps subsequent blocks", () => {
  const onText = mock(() => {});
  const stream = new EveStream({ onText, onIssues: () => {}, onTools: () => {} });
  stream.accept({
    type: "message.appended",
    meta: meta(),
    data: { ...coordinates, messageDelta: "Wrong provisional text" },
  });
  stream.accept({
    type: "message.completed",
    meta: meta(),
    data: { ...coordinates, message: "Correct text", finishReason: "tool-calls" },
  });
  expect(onText).toHaveBeenLastCalledWith("Correct text", true);
  stream.accept({
    type: "message.appended",
    meta: meta(),
    data: { ...coordinates, stepIndex: 1, messageDelta: "After search" },
  });
  stream.accept({
    type: "message.completed",
    meta: meta(),
    data: { ...coordinates, stepIndex: 1, message: "After search", finishReason: "stop" },
  });
  expect(onText).toHaveBeenLastCalledWith("Correct text\n\nAfter search", true);
});

test("Jira tools report their query, progress, count and errors through Eve's call lifecycle", () => {
  const onTools = mock(() => {});
  const onIssues = mock(() => {});
  const stream = new EveStream({ onText: () => {}, onTools, onIssues });
  stream.accept({
    type: "actions.requested",
    meta: meta(),
    data: {
      ...coordinates,
      actions: [
        { kind: "tool-call", callId: "search", toolName: "search_jira", input: { jql: "project = EX", limit: 25 } },
      ],
    },
  });
  expect(onTools).toHaveBeenLastCalledWith([
    { id: "search", name: "Search Jira", query: "project = EX", state: "running", detail: "Searching…" },
  ]);
  const result = JiraSearchResult.parse({ kind: "jira-search", more: true, issues: issues("EX-1", "EX-2") });
  stream.accept({
    type: "action.result",
    meta: meta(),
    data: {
      ...coordinates,
      status: "completed",
      result: { kind: "tool-result", callId: "search", toolName: "search_jira", output: result },
    },
  });
  expect(onTools).toHaveBeenLastCalledWith([
    expect.objectContaining({ state: "completed", detail: "2 issues · more available" }),
  ]);
  expect(onIssues).toHaveBeenLastCalledWith(result.issues);
  stream.accept({
    type: "actions.requested",
    meta: meta(),
    data: {
      ...coordinates,
      actions: [{ kind: "tool-call", callId: "failed", toolName: "search_jira", input: { jql: "bad query" } }],
    },
  });
  stream.accept({
    type: "action.result",
    meta: meta(),
    data: {
      ...coordinates,
      status: "failed",
      error: { code: "error", message: "Jira rejected the query" },
      result: { kind: "tool-result", callId: "failed", toolName: "search_jira", output: "failed", isError: true },
    },
  });
  expect(onTools).toHaveBeenLastCalledWith([
    expect.objectContaining({ state: "completed" }),
    expect.objectContaining({ state: "failed", detail: "Search failed" }),
  ]);
  expect(onIssues).toHaveBeenCalledTimes(1);
});
