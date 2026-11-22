import { expect, mock, test } from "bun:test";
import { deferred, fakeAgent, issues, settle } from "../testing";
import { type AgentBackend, AgentChat } from "./chat";

test("disposing Agent closes a backend that arrives after shutdown", async () => {
  const close = mock(async () => {});
  const pending = deferred<AgentBackend>();
  const start = mock(() => pending.promise);
  const redraw = mock(() => {});
  const chat = new AgentChat(undefined, redraw);

  const connecting = chat.connect(start);
  expect(await chat.connect(start)).toBe(false);
  expect(start).toHaveBeenCalledTimes(1);
  await chat.dispose();

  pending.resolve({ ...fakeAgent(async () => {}), close });
  expect(await connecting).toBe(false);
  expect(close).toHaveBeenCalledTimes(1);
  expect(chat.backend).toBeUndefined();
  expect(redraw).not.toHaveBeenCalled();
});

test("full conversation and Jira evidence remain available after more than six turns", async () => {
  const ask = mock<AgentBackend["ask"]>(async ({ onText, onIssues }) => {
    onIssues(issues("EX-1"));
    onText(`A long reply ${"x".repeat(2000)}`);
  });
  const chat = new AgentChat(fakeAgent(ask), () => {});
  for (let i = 0; i < 9; i++) {
    chat.current.draft.replace([`Question ${i}`]);
    await chat.send();
  }
  const history = ask.mock.calls[8]?.[0].history;
  expect(history).toHaveLength(8);
  expect(history?.[0]?.answer.length).toBeGreaterThan(2000);
  expect(history?.[0]?.issues[0]?.key).toBe("EX-1");
});

test("failed partial replies retain their error and cannot receive late callbacks", async () => {
  const ask = mock<AgentBackend["ask"]>(async ({ onText, onTools }) => {
    onText("Partial reply");
    onTools([{ id: "search", name: "Search Jira", query: "project = EX", state: "running", detail: "Searching…" }]);
    throw new Error("Connection lost");
  });
  const chat = new AgentChat(fakeAgent(ask), () => {});
  chat.current.draft.replace(["Question"]);
  await chat.send();
  const turn = chat.current.turns[0];
  expect(turn).toMatchObject({ answer: "Partial reply", error: "Connection lost", tools: [{ state: "failed" }] });
  expect(chat.current.draft.parts).toEqual(["Question"]);
  ask.mock.calls[0]?.[0].onText("Late text");
  expect(turn?.answer).toBe("Partial reply");
  chat.current.draft.replace(["Next question"]);
  await chat.send();
  expect(turn?.error).toBe("Connection lost");
});

test("interrupting preserves partial output and a new draft while ignoring late tool results", async () => {
  const finish = deferred<void>();
  const ask = mock<AgentBackend["ask"]>(async ({ onText }) => {
    onText("Partial reply");
    await finish.promise;
  });
  const chat = new AgentChat(fakeAgent(ask), () => {});
  chat.current.draft.replace(["First question"]);
  const pending = chat.send();
  await settle();
  chat.current.draft.replace(["Next question"]);
  chat.stop();
  await pending;
  ask.mock.calls[0]?.[0].onIssues(issues("EX-9"));
  expect(chat.current.issues.has("EX-9")).toBe(false);
  expect(chat.current.turns[0]).toMatchObject({ answer: "Partial reply", interrupted: true });
  expect(chat.current.draft.parts).toEqual(["Next question"]);
  finish.resolve();
});

test("prompt history restores attachments and the unsent draft without replacing edited history", async () => {
  const chat = new AgentChat(
    fakeAgent(async ({ onText }) => onText("Reply")),
    () => {},
  );
  const reference = { kind: "issue", key: "EX-1", label: "@EX-1" } as const;
  chat.current.draft.replace(["First ", reference]);
  await chat.send();
  chat.current.draft.replace(["Second"]);
  await chat.send();
  chat.current.draft.replace(["Unsent"]);
  expect(chat.recall(-1)).toBe(true);
  expect(chat.current.draft.parts).toEqual(["Second"]);
  expect(chat.recall(-1)).toBe(true);
  expect(chat.current.draft.parts).toEqual(["First ", reference]);
  expect(chat.recall(1)).toBe(true);
  expect(chat.recall(1)).toBe(true);
  expect(chat.current.draft.parts).toEqual(["Unsent"]);
  chat.recall(-1);
  chat.current.draft.replace(["Edited"]);
  expect(chat.recall(-1)).toBe(false);
  expect(chat.current.draft.parts).toEqual(["Edited"]);
});
