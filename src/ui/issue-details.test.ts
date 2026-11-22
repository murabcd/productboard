import { expect, mock, test } from "bun:test";
import { READ_CACHE_MS } from "../cache";
import type { Detail } from "../jira/types";
import { deferred, settle } from "../testing";
import { IssueDetails } from "./issue-details";

const detail: Detail = { facts: [], description: [], comments: [], attachments: [] };

test("details reuse fresh reads without extending age, retain stale data, and allow forced retry", async () => {
  let now = 0;
  const requests: ReturnType<typeof deferred<Detail>>[] = [];
  const fetch = mock((_key: string) => {
    const reply = deferred<Detail>();
    requests.push(reply);
    return reply.promise;
  });
  const changed = mock(() => {});
  const reads = new IssueDetails(fetch, changed, () => now);
  const first = reads.open("EX-1");
  expect(reads.open("EX-1")).toBe(first);
  requests[0]?.resolve(detail);
  await settle();
  now = READ_CACHE_MS - 1;
  expect(reads.open("EX-1").state).toEqual({ kind: "ready", data: detail });
  expect(fetch).toHaveBeenCalledTimes(1);
  now++;
  const stale = reads.open("EX-1");
  expect(stale.state).toEqual({ kind: "loading", data: detail });
  expect(reads.open("EX-1")).toBe(stale);
  requests[1]?.reject(new Error("Failed"));
  await settle();
  expect(stale.state).toEqual({ kind: "error", data: detail, message: "Failed" });
  const retry = reads.reload(stale);
  const updated = { ...detail, facts: ["Updated"] };
  requests[2]?.resolve(updated);
  await retry;
  expect(reads.open("EX-1").state).toEqual({ kind: "ready", data: updated });
  const forced = reads.reload(stale);
  expect(fetch).toHaveBeenCalledTimes(4);
  requests[3]?.resolve(detail);
  await forced;
  expect(changed).toHaveBeenCalledTimes(4);
});

test("detail eviction is bounded and disposal rejects late writes", async () => {
  const fetch = mock(async (_key: string) => detail);
  const changed = mock(() => {});
  const reads = new IssueDetails(fetch, changed);
  for (let i = 0; i < 51; i++) {
    reads.open(`EX-${i}`);
    await settle();
  }
  reads.open("EX-1");
  expect(fetch).toHaveBeenCalledTimes(51);
  reads.open("EX-0");
  expect(fetch).toHaveBeenCalledTimes(52);
  reads.dispose();
  await settle();
  expect(changed).toHaveBeenCalledTimes(51);
  reads.open("EX-1");
  expect(fetch).toHaveBeenCalledTimes(53);
});
