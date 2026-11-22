import { expect, mock, test } from "bun:test";
import { ClientError } from "eve/client";
import { deferred, fakeAgent, settle } from "../testing";
import { AgentChat } from "./chat";
import { AgentFailure, agentFailure, classifyFailure } from "./failure";

test.each([
  ["context_length_exceeded", 400, "context"],
  ["bad key", 401, "authentication"],
  ["insufficient_quota", 429, "billing"],
  ["model_not_found", 404, "model"],
  ["overloaded", 503, "provider"],
  ["rate_limit_exceeded", 429, "rate-limit"],
  ["content-filter", 0, "filtered"],
  ["network lost", 0, "network"],
  ["unknown private API key", 0, "unknown"],
] as const)("failures classify %s without displaying the provider body", (message, status, kind) => {
  const failure = classifyFailure(message, status);
  expect(failure.kind).toBe(kind);
  expect(failure.message).not.toContain("private API key");
});

test("a transient empty attempt shows its backoff, retries once and rejects old callbacks", async () => {
  const finish = deferred<void>();
  const ask = mock<Parameters<typeof fakeAgent>[0]>(async ({ onText }) => {
    if (ask.mock.calls.length === 1) throw new AgentFailure("provider");
    onText("Recovered");
    await finish.promise;
  });
  const chat = new AgentChat(fakeAgent(ask), () => {});
  chat.current.draft.replace(["Question"]);
  const sending = chat.send();
  await settle();
  expect(chat.current.turns[0]?.state).toMatchObject({ kind: "running", progress: { kind: "retrying", attempt: 2 } });
  await Bun.sleep(1550);
  expect(ask).toHaveBeenCalledTimes(2);
  ask.mock.calls[0]?.[0].onText("Late text from first attempt");
  expect(chat.current.turns[0]?.answer).toBe("Recovered");
  finish.resolve();
  await sending;
  expect(chat.current.turns[0]?.state.kind).toBe("complete");
});

test("stopping backoff never sends the retry and honors long Retry-After without early attempts", async () => {
  const ask = mock<Parameters<typeof fakeAgent>[0]>(async () => {
    throw new AgentFailure("network");
  });
  const chat = new AgentChat(fakeAgent(ask), () => {});
  chat.current.draft.replace(["Question"]);
  const sending = chat.send();
  await settle();
  chat.stop();
  await sending;
  expect(chat.current.turns[0]?.state.kind).toBe("interrupted");
  expect(ask).toHaveBeenCalledTimes(1);
  const failure = agentFailure(new ClientError(429, "private provider body", { "retry-after": "60" }));
  expect(failure.retryAfterMs).toBe(60000);
  const limited = mock<Parameters<typeof fakeAgent>[0]>(async () => {
    throw failure;
  });
  const other = new AgentChat(fakeAgent(limited), () => {});
  other.current.draft.replace(["Question"]);
  await other.send();
  expect(limited).toHaveBeenCalledTimes(1);
  expect(other.current.turns[0]?.state).toMatchObject({ kind: "failed", reason: "rate-limit" });
});

test("partial failures wait for direct retry, preserving the failed reply and an edited draft", async () => {
  const ask = mock<Parameters<typeof fakeAgent>[0]>(async ({ onText }) => {
    if (ask.mock.calls.length === 1) {
      onText("Partial");
      throw new AgentFailure("network");
    }
    onText("Full reply");
  });
  const chat = new AgentChat(fakeAgent(ask), () => {});
  chat.current.draft.replace(["Question"]);
  await chat.send();
  const failed = chat.current.turns[0];
  if (!failed) throw new Error("Missing reply");
  expect(ask).toHaveBeenCalledTimes(1);
  chat.current.draft.replace(["Keep this draft"]);
  await chat.retry(failed.id);
  expect(failed.answer).toBe("Partial");
  expect(failed.state).toMatchObject({ kind: "failed", reason: "network" });
  expect(chat.current.turns[1]?.answer).toBe("Full reply");
  expect(chat.current.draft.parts).toEqual(["Keep this draft"]);
});
