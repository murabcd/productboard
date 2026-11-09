import { describe, expect, test } from "bun:test";
import { rawComment, rawIssue } from "../testing";
import { JiraClient } from "./client";
import { JiraError, JiraHttp } from "./http";
import { initialQuery, View, withView } from "./query";

const credentials = { site: "example.atlassian.net", email: "me@example.com", token: "token" };

type Route = (url: URL, body: Record<string, unknown> | undefined) => Response | Promise<Response>;

/** A fake Jira: records requests and answers them through `route`. */
function fakeJira(route: Route) {
  const requests: { path: string; body?: Record<string, unknown> }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    requests.push({ path: url.pathname, body });
    return route(url, body);
  }) as typeof fetch;
  const http = new JiraHttp(credentials, fetcher, async () => {});
  return { client: new JiraClient(http), http, requests };
}

const json = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" }, ...init });

describe("HTTP", () => {
  test("throttled and failing requests are retried, honoring Retry-After", async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      if (calls === 1) return json({}, { status: 429, headers: { "Retry-After": "2" } });
      if (calls === 2) return json({}, { status: 503 });
      return json({ accountId: "me-id", displayName: "Avery" });
    }) as unknown as typeof fetch;
    const http = new JiraHttp(credentials, fetcher, async (ms) => {
      waits.push(ms);
    });
    const me = await new JiraClient(http).myself();
    expect(me.accountId).toBe("me-id");
    expect(waits).toEqual([2000, 3000]);
  });

  test("board and sprint lists leave room for the issue list", async () => {
    const started: string[] = [];
    const held: (() => void)[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      started.push(new URL(String(input)).pathname);
      await new Promise<void>((resolve) => held.push(resolve));
      return json({ values: [], isLast: true, issues: [] });
    }) as typeof fetch;
    const client = new JiraClient(new JiraHttp(credentials, fetcher, async () => {}));
    for (let n = 0; n < 10; n++) void client.sprints(String(n));
    await Bun.sleep(0);
    void client.search("project = EX", [], 10);
    await Bun.sleep(0);
    // Four sprint lists run; the search starts at once instead of queueing behind six more.
    expect(started.filter((path) => path.includes("/sprint")).length).toBe(4);
    expect(started.at(-1)).toBe("/rest/api/3/search/jql");
    for (const release of held.splice(0)) release();
  });

  test("a stalled connection is raced by a second attempt", async () => {
    let calls = 0;
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls++;
      if (calls === 1) {
        // The first connection hangs until it is abandoned.
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      }
      return json({ accountId: "me-id", displayName: "Avery" });
    }) as typeof fetch;
    const started = performance.now();
    const me = await new JiraClient(new JiraHttp(credentials, fetcher, async () => {})).myself();
    expect(me.accountId).toBe("me-id");
    expect(calls).toBe(2);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  test("a rejected token explains how to fix it and is not retried", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return json({}, { status: 401 });
    }) as unknown as typeof fetch;
    const http = new JiraHttp(credentials, fetcher, async () => {});
    await expect(new JiraClient(http).myself()).rejects.toThrow("boardbeat --login");
    expect(calls).toBe(1);
  });

  test("Jira's own error messages are shown", async () => {
    const { client } = fakeJira(() => json({ errorMessages: ["Field 'x' does not exist"] }, { status: 400 }));
    await expect(client.search("bad", [], 10)).rejects.toThrow("Field 'x' does not exist");
  });
});

describe("attachments", () => {
  test("downloads follow Jira's redirect without sending the token elsewhere", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, auth: new Headers(init?.headers).get("Authorization") });
      if (url.includes("example.atlassian.net")) {
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 303,
          headers: { Location: "https://api.media.atlassian.com/file/x?token=signed" },
        });
      }
      return new Response(new Uint8Array([137, 80, 78, 71]));
    }) as typeof fetch;
    const http = new JiraHttp(credentials, fetcher, async () => {});
    const bytes = await new JiraClient(http).attachment("42");
    expect([...bytes]).toEqual([137, 80, 78, 71]);
    expect(seen[0]).toMatchObject({ url: "https://example.atlassian.net/rest/api/3/attachment/content/42" });
    expect(seen[0]?.auth).toStartWith("Basic ");
    expect(seen[1]).toEqual({ url: "https://api.media.atlassian.com/file/x?token=signed", auth: null });
  });
});

describe("search", () => {
  test("follows page tokens and reports more beyond the limit", async () => {
    const { client, requests } = fakeJira((_url, body) => {
      if (!body?.nextPageToken) return json({ issues: [rawIssue("EX-1"), rawIssue("EX-2")], nextPageToken: "p2" });
      return json({ issues: [rawIssue("EX-3")], isLast: true });
    });
    const snapshot = await client.snapshot({ ...initialQuery, view: View.All, limit: 2 });
    expect(snapshot.issues.map((i) => i.key)).toEqual(["EX-1", "EX-2"]);
    expect(snapshot.more).toBe(true);
    expect(requests[0]?.body).toMatchObject({ maxResults: 3, fields: ["summary", "status", "priority", "assignee"] });
  });

  test("a repeated page token cannot loop forever", async () => {
    const { client, requests } = fakeJira(() => json({ issues: [rawIssue("EX-1")], nextPageToken: "same" }));
    await client.search("x", [], 10);
    expect(requests.length).toBe(2);
  });
});

describe("mentions", () => {
  test("found from search comments, reading only truncated threads, newest mention first", async () => {
    const { client, requests } = fakeJira((url) => {
      if (url.pathname.endsWith("/myself")) return json({ accountId: "me-id", displayName: "Avery" });
      if (url.pathname.endsWith("/EX-3/comment")) {
        return json({ comments: [rawComment("Late ", "2026-11-09T12:00:00.000+0300", "me-id")], total: 1 });
      }
      const withComments = (key: string, comments: unknown[], total = comments.length) => ({
        ...rawIssue(key),
        fields: { ...rawIssue(key).fields, comment: { comments, total } },
      });
      return json({
        issues: [
          withComments("EX-1", [rawComment("Old ", "2026-11-01T09:00:00.000+0300", "me-id")]),
          withComments("EX-2", [rawComment("Not you ", "2026-11-08T09:00:00.000+0300", "other")]),
          withComments("EX-3", [], 30), // more comments than search returned
        ],
        isLast: true,
      });
    });
    const snapshot = await client.snapshot(withView(initialQuery, View.Mentions));
    expect(snapshot.issues.map((i) => i.key)).toEqual(["EX-3", "EX-1"]);
    expect(snapshot.issues[0]?.mention?.created).toBe("2026-11-09 12:00");
    expect(snapshot.scanned).toBe(3);
    expect(requests.filter((r) => r.path.endsWith("/comment")).map((r) => r.path)).toEqual([
      "/rest/api/3/issue/EX-3/comment",
    ]);
    expect(requests[0]?.body?.fields).toContain("comment");
  });
});

describe("boards and sprints", () => {
  test("boards and projects are read across pages", async () => {
    const { client } = fakeJira((url) => {
      const startAt = Number(url.searchParams.get("startAt"));
      if (url.pathname.endsWith("/board")) {
        return startAt === 0
          ? json({ values: [{ id: 2, name: "Team B" }], isLast: false })
          : json({ values: [{ id: 1, name: "Team A", location: { displayName: "Example (EX)" } }], isLast: true });
      }
      return json({ values: [{ key: "EX", name: "Example" }], isLast: true });
    });
    const catalog = await client.catalog();
    expect(catalog.boards.map((b) => [b.label, b.detail])).toEqual([
      ["Team A", "Example (EX)"],
      ["Team B", ""],
    ]);
    expect(catalog.projects[0]?.value).toBe("EX");
  });

  test("sprints keep Jira's state; boards without sprints say so", async () => {
    const { client } = fakeJira((url) =>
      url.pathname.includes("/board/9/")
        ? json({ errorMessages: ["The board does not support sprints"] }, { status: 400 })
        : json({
            values: [
              { id: 20, name: "Recent closed", state: "closed" },
              { id: 1, name: "Old but active", state: "active", endDate: "2020-01-01" },
            ],
            isLast: true,
          }),
    );
    expect((await client.sprints("4")).map((s) => [s.id, s.state])).toEqual([
      [1, "active"],
      [20, "closed"],
    ]);
    await expect(client.sprints("9")).rejects.toThrow(JiraError);
    await expect(client.sprints("9")).rejects.toThrow("doesn't use sprints");
  });
});
