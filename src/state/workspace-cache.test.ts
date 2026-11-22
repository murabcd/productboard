import { expect, test } from "bun:test";
import type { Snapshot } from "../jira/client";
import { type IssueQuery, initialQuery, View } from "../jira/query";
import type { Choice, Sprint } from "../jira/types";
import { deferred, settle, snapshot } from "../testing";
import { REFRESH_MS, type Source, Workspace } from "./workspace";

function setup() {
  let now = 0;
  const requests: { query: IssueQuery; signal: AbortSignal; reply: ReturnType<typeof deferred<Snapshot>> }[] = [];
  const sprints: { board: string; reply: ReturnType<typeof deferred<Sprint[]>> }[] = [];
  const source: Source = {
    snapshot: (query, signal) => {
      const reply = deferred<Snapshot>();
      requests.push({ query, signal, reply });
      return reply.promise;
    },
    boards: async () => [],
    projects: async () => [],
    sprints: (board) => {
      const reply = deferred<Sprint[]>();
      sprints.push({ board, reply });
      return reply.promise;
    },
  };
  const work = new Workspace(source, { now: () => now });
  const a = { ...initialQuery, view: View.Team, project: "A" };
  const b = { ...a, project: "B" };
  async function answer(keys = ["EX-1"], more = false) {
    const request = requests.at(-1);
    if (!request) throw new Error("Missing request");
    request.reply.resolve(snapshot(request.query, keys, more));
    await settle();
  }
  return { work, source, requests, sprints, a, b, answer, advance: (ms: number) => (now += ms) };
}

const boards: Choice[] = ["A", "B"].map((value) => ({ value, label: value, detail: "", state: "" }));
const active: Sprint[] = [{ id: 1, name: "Active", state: "active", start: "", end: "", goal: "" }];

test("A → B → A restores rows, warnings and original age without another request", async () => {
  const { work, requests, a, b, answer, advance } = setup();
  work.change(a);
  requests[0]?.reply.resolve({ ...snapshot(a, ["EX-1"], true), warnings: ["Partial check"] });
  await settle();
  advance(10_000);
  work.change(b);
  await answer(["EX-2"]);
  work.change(a);
  expect(requests).toHaveLength(2);
  expect(work.pending).toBe(false);
  expect(work.issues.map((issue) => issue.key)).toEqual(["EX-1"]);
  expect(work.snapshot?.warnings).toEqual(["Partial check"]);
  expect(work.more).toBe(true);
  expect(work.updated?.getTime()).toBe(0);
  advance(REFRESH_MS - 10_000 - 1);
  work.tick();
  expect(requests).toHaveLength(2);
  advance(1);
  work.tick();
  work.tick();
  expect(requests).toHaveLength(3);
});

test("expired results render immediately, failures preserve data, and r forces a fresh read", async () => {
  const { work, requests, a, b, answer, advance } = setup();
  work.change(a);
  await answer();
  work.change(b);
  await answer(["EX-2"]);
  advance(REFRESH_MS);
  work.change(a);
  expect(work.issues[0]?.key).toBe("EX-1");
  expect(work.pending).toBe(true);
  requests.at(-1)?.reply.reject(new Error("Unavailable"));
  await settle();
  expect(work.issues[0]?.key).toBe("EX-1");
  expect(work.updated?.getTime()).toBe(0);
  expect(work.error).toBe("Unavailable");
  work.refresh();
  await answer(["EX-3"]);
  work.change(b);
  await answer(["EX-2"]);
  work.change(a);
  expect(work.issues[0]?.key).toBe("EX-3");
  const before = requests.length;
  work.refresh();
  work.refresh();
  expect(requests).toHaveLength(before + 1);
});

test("pagination and query filters have distinct entries; late responses cannot replace cached results", async () => {
  const { work, requests, a, b, answer } = setup();
  work.change(a);
  await answer(["EX-1"], true);
  work.loadMore();
  await answer(["EX-1", "EX-2"]);
  work.change({ ...a, assignee: "unassigned" });
  work.change(a);
  expect(work.issues).toHaveLength(1);
  expect(work.more).toBe(true);
  expect(requests.at(-1)?.signal.aborted).toBe(true);
  requests.at(-1)?.reply.resolve(snapshot({ ...a, assignee: "unassigned" }, ["EX-OLD"]));
  await settle();
  expect(work.issues[0]?.key).toBe("EX-1");
  work.loadMore();
  expect(work.issues).toHaveLength(2);
  expect(requests).toHaveLength(3);
  work.change(b);
  await answer(["EX-3"]);
  work.change({ ...a, limit: 400 });
  expect(work.issues).toHaveLength(2);
  expect(requests).toHaveLength(4);
});

test("recently used queries survive bounded eviction", async () => {
  const { work, requests, a, answer } = setup();
  for (let i = 0; i < 20; i++) {
    work.change({ ...a, project: String(i) });
    await answer();
  }
  work.change({ ...a, project: "0" });
  expect(requests).toHaveLength(20);
  work.change({ ...a, project: "20" });
  await answer();
  work.change({ ...a, project: "0" });
  expect(requests).toHaveLength(21);
  work.change({ ...a, project: "1" });
  expect(requests).toHaveLength(22);
});

test("board switches and empty sprint pickers reuse recent catalogs, then refresh stale choices", async () => {
  const { work, sprints, advance } = setup();
  work.chooseBoard("A");
  sprints[0]?.reply.resolve([]);
  await settle();
  work.chooseBoard("B");
  sprints[1]?.reply.resolve([]);
  await settle();
  work.chooseBoard("A");
  await work.loadSprints();
  expect(sprints.map(({ board }) => board)).toEqual(["A", "B"]);
  advance(REFRESH_MS);
  work.chooseBoard("B");
  expect(sprints).toHaveLength(3);
  sprints[2]?.reply.reject(new Error("Sprints unavailable"));
  await settle();
  expect(work.sprintCatalogError).toBe("Sprints unavailable");
  advance(REFRESH_MS);
  work.tick();
  expect(sprints).toHaveLength(4);
});

test("discovery retains every successful catalog without renewing its completion time", async () => {
  const { work, source, sprints, advance } = setup();
  source.boards = async () => boards;
  work.loadCatalog();
  await settle();
  sprints[1]?.reply.resolve(active);
  await settle();
  advance(10_000);
  sprints[0]?.reply.resolve([]);
  await settle();
  expect(work.board).toBe("B");
  expect(work.sprints).toEqual(active);
  work.chooseBoard("A");
  expect(work.sprints).toEqual([]);
  work.chooseBoard("B");
  expect(sprints).toHaveLength(2);
  advance(REFRESH_MS - 10_000);
  void work.loadSprints();
  expect(sprints).toHaveLength(3);
  sprints[2]?.reply.resolve(active);
  await settle();
});

test("failed discovery reports its error and retries; failures never become fresh empty catalogs", async () => {
  const { work, source, sprints, advance } = setup();
  source.boards = async () => boards;
  work.loadCatalog();
  await settle();
  sprints[0]?.reply.reject(new Error("A unavailable"));
  sprints[1]?.reply.reject(new Error("B unavailable"));
  await settle();
  expect(work.board).toBe("");
  expect(work.sprintCatalogError).toBe("A unavailable");
  expect(work.sprintsPending).toBe(false);
  advance(REFRESH_MS - 1);
  work.tick();
  expect(sprints).toHaveLength(2);
  advance(1);
  work.tick();
  work.tick();
  expect(sprints).toHaveLength(4);
  sprints[2]?.reply.reject(new Error("Still unavailable"));
  sprints[3]?.reply.resolve([]);
  await settle();
  expect(work.board).toBe("B");
  expect(work.sprintCatalogError).toBe("");
  work.chooseBoard("A");
  expect(sprints.map(({ board }) => board)).toEqual(["A", "B", "A", "B", "A"]);
});

test("abandoned board discovery cannot publish or cache late results", async () => {
  const { work, source, sprints } = setup();
  source.boards = async () => boards;
  work.loadCatalog();
  await settle();
  work.chooseBoard("C");
  sprints[0]?.reply.resolve(active);
  sprints[1]?.reply.resolve([]);
  sprints[2]?.reply.resolve([]);
  await settle();
  expect(work.board).toBe("C");
  expect(work.sprints).toEqual([]);
  work.chooseBoard("A");
  expect(sprints.map(({ board }) => board)).toEqual(["A", "B", "C", "A"]);
});
