import { expect, mock, test } from "bun:test";
import { deferred, fakeAgent } from "../testing";
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
