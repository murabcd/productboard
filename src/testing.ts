/** Shared test fixtures: Jira-shaped payloads and controllable promises. */

import type { Snapshot } from "./jira/client";
import { type RawIssue, toIssue } from "./jira/parse";
import type { IssueQuery } from "./jira/query";
import type { Category } from "./jira/types";

export function rawIssue(
  key = "EX-1",
  category: Category = "new",
  options: { title?: string; person?: { accountId: string; displayName: string } | null } = {},
): RawIssue {
  return {
    key,
    fields: {
      summary: options.title ?? "Рабочая задача",
      status: { name: `Custom ${category}`, statusCategory: { key: category } },
      priority: null,
      assignee: options.person ?? null,
    },
  };
}

export const issues = (...keys: string[]) => keys.map((key) => toIssue(rawIssue(key)));

export function snapshot(query: IssueQuery, keys: string[], more = false): Snapshot {
  return { issues: issues(...keys), query, more, scanned: 0 };
}

export function textDoc(...content: unknown[]) {
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

export function rawComment(text: string, created: string, mention?: string) {
  const content: unknown[] = [{ type: "text", text }];
  if (mention) content.push({ type: "mention", attrs: { id: mention, text: "@Avery" } });
  return { author: { displayName: "Charlie" }, created, body: textDoc(...content) };
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let pending promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
