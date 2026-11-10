import { describe, expect, mock, test } from "bun:test";
import type { Catalog, Snapshot } from "../jira/client";
import { type IssueQuery, initialQuery, View } from "../jira/query";
import type { Sprint } from "../jira/types";
import { type Deferred, deferred, settle, snapshot } from "../testing";
import { REFRESH_MS, Workspace } from "./workspace";

/** A workspace whose requests stay pending until the test answers them. */
function setup() {
  const requests: { query: IssueQuery; reply: Deferred<Snapshot> }[] = [];
  const source = {
    snapshot: mock((query: IssueQuery) => {
      const reply = deferred<Snapshot>();
      requests.push({ query, reply });
      return reply.promise;
    }),
    catalog: mock((): Promise<Catalog> => deferred<Catalog>().promise),
    sprints: mock((_board: string): Promise<Sprint[]> => deferred<Sprint[]>().promise),
  };
  let now = 1_000_000;
  const work = new Workspace(source, { now: () => now });
  const team = { ...initialQuery, view: View.All };
  work.query = team;
  work.snapshot = snapshot(team, ["EX-1", "EX-2"], true);
  return { work, source, requests, team, advance: (ms: number) => (now += ms) };
}

describe("workspace", () => {
  test("a failed refresh keeps the last successful list", async () => {
    const { work, requests } = setup();
    work.refresh();
    requests[0]?.reply.reject(new Error("network failed"));
    await settle();
    expect(work.issues.map((i) => i.key)).toEqual(["EX-1", "EX-2"]);
    expect(work.error).toContain("network failed");
    work.refresh();
    expect(work.error).toBe("");
    expect(work.pending).toBe(true);
  });

  test("a stale response never appears under a different view", async () => {
    const { work, requests, team } = setup();
    work.refresh();
    work.change({ ...initialQuery, view: View.Created });
    expect(work.issues).toEqual([]);
    requests[0]?.reply.resolve(snapshot(team, ["EX-OLD"]));
    await settle();
    expect(work.issues).toEqual([]);
    expect(requests[1]?.query.view).toBe(View.Created);
    requests[1]?.reply.resolve(snapshot(work.query, ["EX-NEW"]));
    await settle();
    expect(work.issues.map((i) => i.key)).toEqual(["EX-NEW"]);
  });

  test("switching views starts loading at once instead of waiting", () => {
    const { work, source } = setup();
    work.refresh();
    work.change({ ...initialQuery, view: View.Created });
    expect(source.snapshot).toHaveBeenCalledTimes(2);
    work.refresh(); // the same request is already running
    expect(source.snapshot).toHaveBeenCalledTimes(2);
  });

  test("loading more keeps the list visible and works during a refresh", () => {
    const { work, requests } = setup();
    work.refresh();
    work.loadMore();
    expect(work.query.limit).toBe(400);
    expect(work.issues.length).toBe(2);
    expect(requests.at(-1)?.query.limit).toBe(400);
    work.loadMore(); // waits for the larger list first
    expect(work.query.limit).toBe(400);
  });

  test("the list refreshes on schedule", async () => {
    const { work, requests, advance } = setup();
    work.refresh();
    requests[0]?.reply.resolve(snapshot(work.query, ["EX-1"]));
    await settle();
    work.tick();
    expect(requests.length).toBe(1);
    const changes = mock(() => {});
    work.subscribe(changes);
    advance(REFRESH_MS);
    work.tick();
    expect(requests.length).toBe(2);
    expect(changes).toHaveBeenCalled(); // the screen shows "Refreshing…" without a redraw timer
  });

  test("failed board lists retry on the refresh cycle", async () => {
    const { work, source, advance } = setup();
    source.catalog.mockImplementationOnce(() => Promise.reject(new Error("boards failed")));
    work.loadCatalog();
    await settle();
    expect(work.catalogError).toContain("boards failed");
    advance(REFRESH_MS);
    work.tick();
    expect(source.catalog).toHaveBeenCalledTimes(2);
    expect(work.catalogError).toBe("");
  });

  test("without a remembered board, the one with the most active sprints opens", async () => {
    const { source } = setup();
    const sprint = (id: number, state: "active" | "closed") => ({
      id,
      name: `S${id}`,
      state,
      start: "",
      end: "",
      goal: "",
    });
    const board = (value: string, label: string) => ({ value, label, detail: "", state: "" });
    source.catalog.mockImplementation(() =>
      Promise.resolve({ boards: [board("13", "BT board"), board("2", "FLOM board")], projects: [] }),
    );
    source.sprints.mockImplementation((id: string) =>
      Promise.resolve(id === "2" ? [sprint(5, "active"), sprint(4, "closed")] : [sprint(1, "closed")]),
    );
    const remembered: string[] = [];
    const work = new Workspace(source, { rememberBoard: (b) => remembered.push(b) });
    work.loadCatalog();
    await settle();
    await settle();
    expect(work.board).toBe("2");
    expect(work.sprints.map((s) => s.id)).toEqual([5, 4]);
    expect(remembered).toEqual([]); // an automatic pick is not remembered
    work.chooseBoard("13");
    expect(remembered).toEqual(["13"]);
  });
});
