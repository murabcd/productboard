import { expect, mock, test } from "bun:test";
import { deferred, fakeAgent, settle } from "../testing";
import { AgentChat } from "./chat";

test("queued follow-ups keep order, attachments and edits without steering the active reply", async () => {
  const first = deferred<void>();
  const ask = mock<Parameters<typeof fakeAgent>[0]>(async ({ prompt, onText }) => {
    onText(`Reply ${prompt}`);
    if (prompt === "First") await first.promise;
  });
  const chat = new AgentChat(fakeAgent(ask), () => {});
  chat.current.draft.replace(["First"]);
  const running = chat.send();
  await settle();
  const image = { filename: "shot.png", mediaType: "image/png", bytes: new Uint8Array([1, 2, 3]) };
  chat.current.draft.restore({ parts: ["Second", { kind: "image", label: "[Image]" }], images: [image] });
  await chat.send();
  chat.current.draft.replace(["Third"]);
  await chat.send();
  expect(ask).toHaveBeenCalledTimes(1);
  const id = chat.current.queue.entries[0]?.id;
  if (!id) throw new Error("Expected queued message");
  chat.editQueued(id);
  expect(chat.current.queue.entries[0]?.kind).toBe("editing");
  chat.current.draft.replace([...chat.current.draft.parts, " edited"]);
  await chat.send();
  expect(chat.current.queue.entries[0]?.id).toBe(id);
  first.resolve();
  await running;
  expect(ask.mock.calls.map(([request]) => request.prompt)).toEqual(["First", "Second edited", "Third"]);
  expect(ask.mock.calls[1]?.[0].images).toEqual([image]);
  expect(ask.mock.calls[2]?.[0].history).toHaveLength(2);
  expect(chat.current.queue.length).toBe(0);
});

test("interrupt pauses the queue and an editing placeholder blocks automatic delivery", async () => {
  const first = deferred<void>();
  const ask = mock<Parameters<typeof fakeAgent>[0]>(async ({ onText }) => {
    onText("Partial");
    if (ask.mock.calls.length === 1) await first.promise;
  });
  const chat = new AgentChat(fakeAgent(ask), () => {});
  chat.current.draft.replace(["First"]);
  const running = chat.send();
  await settle();
  chat.current.draft.replace(["Second"]);
  await chat.send();
  chat.stop();
  await running;
  expect(ask).toHaveBeenCalledTimes(1);
  const id = chat.current.queue.entries[0]?.id;
  if (!id) throw new Error("Missing queue");
  chat.editQueued(id);
  await chat.resumeQueue();
  expect(ask).toHaveBeenCalledTimes(1);
  chat.current.draft.replace(["Second edited"]);
  await chat.send();
  expect(ask).toHaveBeenCalledTimes(2);
  expect(chat.current.turns[0]?.state.kind).toBe("interrupted");
  expect(chat.current.turns[1]?.prompt).toBe("Second edited");
  first.resolve();
});

test("send now interrupts deliberately, retains queued follow-ups and preserves a newly edited draft", async () => {
  const first = deferred<void>();
  const ask = mock<Parameters<typeof fakeAgent>[0]>(async ({ prompt, onText }) => {
    onText(`Reply ${prompt}`);
    if (prompt === "First") await first.promise;
  });
  const chat = new AgentChat(fakeAgent(ask), () => {});
  chat.current.draft.replace(["First"]);
  const running = chat.send();
  await settle();
  chat.current.draft.replace(["Later"]);
  await chat.send();
  chat.current.draft.replace(["Now"]);
  const steering = chat.sendNow();
  chat.current.draft.replace(["New unsent draft"]);
  await Promise.all([running, steering]);
  expect(ask.mock.calls.map(([request]) => request.prompt)).toEqual(["First", "Now", "Later"]);
  expect(chat.current.turns[0]?.state.kind).toBe("interrupted");
  expect(chat.current.draft.parts).toEqual(["New unsent draft"]);
  first.resolve();
});

test("canceling an edited queue entry keeps the draft and editing never overwrites another draft", async () => {
  const first = deferred<void>();
  const chat = new AgentChat(
    fakeAgent(async ({ onText }) => {
      onText("Reply");
      await first.promise;
    }),
    () => {},
  );
  chat.current.draft.replace(["First"]);
  const running = chat.send();
  await settle();
  chat.current.draft.replace(["Queued"]);
  await chat.send();
  const id = chat.current.queue.entries[0]?.id;
  if (!id) throw new Error("Missing queue");
  chat.current.draft.replace(["Keep draft"]);
  chat.editQueued(id);
  expect(chat.current.draft.parts).toEqual(["Keep draft"]);
  expect(chat.current.draft.error).toContain("Finish or clear");
  chat.current.draft.replace([]);
  chat.editQueued(id);
  chat.cancelQueued(id);
  expect(chat.current.draft.parts).toEqual(["Queued"]);
  expect(chat.current.queue.length).toBe(0);
  chat.stop();
  await running;
  first.resolve();
});
