import { expect, mock, test } from "bun:test";
import { deferred, fakeAgent, issues, settle } from "../testing";
import { AgentChat } from "./chat";
import { contextText, contextTurns, summarizeContext } from "./context";

test("a checkpoint reduces model input while preserving the complete chat and later evidence", async () => {
  const ask = mock<Parameters<typeof fakeAgent>[0]>(async ({ onText, onIssues }) => {
    onText("Original answer");
    onIssues(issues("EX-1"));
  });
  const discardThread = mock(() => {});
  const compact = mock(async () => "User wants sprint risk analysis; EX-1 needs review.");
  const chat = new AgentChat({ ...fakeAgent(ask), compact, discardThread }, () => {});
  chat.current.draft.replace(["Review sprint"]);
  await chat.send();
  const before = JSON.stringify(chat.current.turns);
  await chat.compact();
  expect(JSON.stringify(chat.current.turns)).toBe(before);
  expect(discardThread).toHaveBeenCalledWith(chat.current.id);
  expect(contextTurns(chat.current.turns, chat.current.checkpoint)).toEqual([]);
  expect(contextText(chat.current.turns, chat.current.checkpoint)).toContain("sprint risk analysis");
  chat.current.draft.replace(["Continue"]);
  await chat.send();
  expect(ask.mock.calls[1]?.[0].checkpoint).toEqual(chat.current.checkpoint);
  expect(contextTurns(chat.current.turns, chat.current.checkpoint)).toHaveLength(1);
  expect(contextText(chat.current.turns, chat.current.checkpoint)).toContain("Continue");
  expect(contextTurns(chat.current.turns, { through: crypto.randomUUID(), summary: "stale", created: 0 })).toBe(
    chat.current.turns,
  );
});

test("failed or interrupted compaction keeps the previous checkpoint, drafts and full record", async () => {
  const pending = deferred<string>();
  const compact = mock(() => pending.promise);
  const chat = new AgentChat({ ...fakeAgent(async ({ onText }) => onText("Reply")), compact }, () => {});
  chat.current.draft.replace(["Question"]);
  await chat.send();
  chat.current.checkpoint = { through: chat.current.turns[0]?.id ?? "", summary: "Kept", created: 0 };
  chat.current.draft.replace(["Draft"]);
  const checkpoint = chat.current.checkpoint;
  const running = chat.compact();
  await settle();
  await chat.send();
  expect(chat.current.turns).toHaveLength(1);
  chat.stop();
  await running;
  pending.resolve("Late summary");
  await settle();
  expect(chat.current.checkpoint).toBe(checkpoint);
  expect(chat.current.draft.parts).toEqual(["Draft"]);
  expect(chat.current.draft.error).toContain("Previous context kept");
});

test("long transcripts compact in bounded segments without a blind character cutoff", async () => {
  const summarize = mock<(prompt: string) => Promise<string>>(async () => "Checkpoint");
  await summarizeContext(`${"x".repeat(40000)} FINAL EVIDENCE`, summarize);
  expect(summarize).toHaveBeenCalledTimes(3);
  expect(summarize.mock.calls[2]?.[0]).toContain("FINAL EVIDENCE");
  expect(summarize.mock.calls[1]?.[0]).toContain("Prior checkpoint:\nCheckpoint");
  await expect(summarizeContext("Evidence", async () => "")).rejects.toThrow("previous context was kept");
});
