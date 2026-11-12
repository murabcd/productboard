import { expect, mock, test } from "bun:test";
import type { Client } from "eve/client";
import type { AgentChoice } from "../auth";
import { deferred, settle } from "../testing";
import { AgentChat } from "./chat";
import { EveAgent } from "./eve";

test("a model switch while a turn waits for Eve retirement cannot change its attribution", async () => {
  const ready = deferred<Client>();
  const exited = deferred<void>();
  const close = mock(() => exited.promise);
  const start = mock(() => ({ ready: ready.promise, exited: exited.promise, sessions: new Map(), close }));
  const low: AgentChoice = { provider: "openai", model: "fixture", reasoning: "low" };
  const medium = { ...low, reasoning: "medium" } as const;
  const high = { ...low, reasoning: "high" } as const;
  const agent = EveAgent.create(
    { search: async () => [] },
    { read: () => low, recent: () => [], key: () => "fixture", remember: () => [], start },
  );
  if (!agent) throw new Error("Expected a configured Agent");
  const first = new AgentChat(agent, () => {});
  const second = new AgentChat(agent, () => {});
  try {
    first.current.draft.replace(["Start a turn on Low"]);
    const firstTurn = first.send();
    await settle();
    expect(start).toHaveBeenCalledTimes(1);

    const changing = agent.use(medium, "reasoning");
    second.current.draft.replace(["Turn admitted under Medium"]);
    const waiting = second.send();
    const changedAgain = agent.use(high, "reasoning");
    expect(second.current.turns[0]?.choice).toEqual(medium);

    ready.reject(new Error("Previous process closed"));
    exited.resolve();
    await Promise.all([changing, changedAgain, firstTurn, waiting]);
    expect(agent.current).toEqual(high);
    expect(start).toHaveBeenCalledTimes(1);
    expect(second.current.turns).toEqual([]);
    expect(second.current.draft.parts).toEqual(["Turn admitted under Medium"]);
    expect(second.current.draft.error).toBe("Agent restarted. Send the question again.");
  } finally {
    exited.resolve();
    await agent.close();
  }
});
