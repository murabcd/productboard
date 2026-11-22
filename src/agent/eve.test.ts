import { expect, mock, test } from "bun:test";
import { Client, type ClientSession } from "eve/client";
import type { AgentChoice } from "../auth";
import { deferred, fakeAgent, issues, settle } from "../testing";
import { AgentChat } from "./chat";
import { EveAgent } from "./eve";

test("a connected ChatGPT account can start Eve and offer models without API keys", async () => {
  const choice: AgentChoice = { provider: "chatgpt", model: "gpt-6-luna", reasoning: "medium" };
  const ready = deferred<Client>();
  const exited = deferred<void>();
  const start = mock(() => ({
    ready: ready.promise,
    exited: exited.promise,
    sessions: new Map(),
    close: async () => exited.resolve(),
  }));
  const agent = EveAgent.create(
    { search: async () => [] },
    {
      read: () => choice,
      recent: () => [],
      key: () => undefined,
      chatgpt: () => true,
      subscriptionModels: async () => [{ model: choice.model, isDefault: true }],
      remember: () => [],
      start,
    },
  );
  if (!agent) throw new Error("Expected an Agent with subscription credentials");
  expect(await agent.models()).toMatchObject([{ provider: "chatgpt", model: choice.model }]);
  const chat = new AgentChat(agent, () => {});
  chat.current.draft.replace(["Start a test turn"]);
  const turn = chat.send();
  await settle();
  expect(start).toHaveBeenCalledWith(expect.anything(), { choice, credentials: {} });
  ready.reject(new Error("End the test before sending a model request"));
  await turn;
  await agent.close();
});

test("a replacement Eve session receives full history, evidence and earlier images over HTTP", async () => {
  let payload: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/eve/v1/session") return Response.json({ sessionId: "replacement" });
      if (path.endsWith("/reset")) return Response.json({ status: "reset", sessionId: "replacement" });
      payload = await request.json();
      return new Response("Stop before model inference", { status: 400 });
    },
  });
  const exited = deferred<void>();
  const choice: AgentChoice = { provider: "openai", model: "fixture", reasoning: "medium" };
  const agent = EveAgent.create(
    { search: async () => [] },
    {
      read: () => choice,
      recent: () => [],
      key: () => "fixture",
      chatgpt: () => false,
      subscriptionModels: async () => [],
      remember: () => [],
      start: () => ({
        ready: Promise.resolve(new Client({ host: server.url.href })),
        exited: exited.promise,
        sessions: new Map<string, ClientSession>(),
        close: async () => exited.resolve(),
      }),
    },
  );
  if (!agent) throw new Error("Expected a configured Agent");
  try {
    const chat = new AgentChat(
      fakeAgent(async ({ onText, onIssues }) => {
        onText(`Full answer ${"x".repeat(2000)} END`);
        onIssues(issues("EX-1"));
      }),
      () => {},
    );
    for (let i = 0; i < 8; i++) {
      chat.current.draft.replace([
        `Question ${i}`,
        { kind: "sprint", label: "Sprint 31", sprint: { id: 31, name: "Web sprint" } },
      ]);
      await chat.send();
    }
    const first = chat.current.turns[0];
    if (!first) throw new Error("Expected a prior turn");
    const history = [
      { ...first, images: [{ filename: "old.png", mediaType: "image/png", bytes: new Uint8Array([1, 2, 3]) }] },
      ...chat.current.turns.slice(1),
    ];
    await expect(
      agent.ask({
        thread: "chat",
        prompt: "Continue",
        images: [],
        signal: AbortSignal.timeout(2000),
        history,
        onText: () => {},
        onIssues: () => {},
        onTools: () => {},
      }),
    ).rejects.toThrow("could not finish");
    const serialized = JSON.stringify(payload);
    expect(payload).toMatchObject({
      message: [
        { type: "text", text: expect.stringContaining(`Full answer ${"x".repeat(2000)} END`) },
        { type: "file", filename: "old.png", mediaType: "image/png", data: "data:image/png;base64,AQID" },
      ],
    });
    expect(serialized).toContain("Question 0");
    expect(serialized).toContain("Question 7");
    expect(serialized).toContain("EX-1");
    expect(serialized).toContain("Web sprint");
  } finally {
    await agent.close();
    server.stop(true);
  }
});

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
    {
      read: () => low,
      recent: () => [],
      key: () => "fixture",
      chatgpt: () => false,
      subscriptionModels: async () => [],
      remember: () => [],
      start,
    },
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
    expect(second.current.turns).toMatchObject([
      { state: { kind: "failed", error: "Agent restarted. Send the question again." }, answer: "" },
    ]);
    expect(second.current.draft.parts).toEqual(["Turn admitted under Medium"]);
    expect(second.current.draft.error).toBe("Agent restarted. Send the question again.");
  } finally {
    exited.resolve();
    await agent.close();
  }
});
