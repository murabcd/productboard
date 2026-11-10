import { randomBytes } from "node:crypto";
import { JiraSearchInput, type JiraSearchResult } from "../../agent/lib/jira-search";
import type { JiraClient } from "../jira/client";
import { JiraError } from "../jira/http";
import { LIST_FIELDS, toIssue } from "../jira/parse";

/** The local Eve process can search through the dashboard's existing Jira client. */
export function openJiraSearch(jira: Pick<JiraClient, "search">) {
  const token = randomBytes(32).toString("hex");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 8 * 1024,
    idleTimeout: 60,
    async fetch(request) {
      if (request.method !== "POST" || request.headers.get("Authorization") !== `Bearer ${token}`)
        return new Response(null, { status: 404 });
      const input = JiraSearchInput.safeParse(await request.json().catch(() => null));
      if (!input.success) return new Response(null, { status: 400 });
      const { jql, limit } = input.data;
      try {
        const found = await jira.search(jql, LIST_FIELDS, limit + 1, {
          priority: "background",
          signal: request.signal,
        });
        const result: JiraSearchResult = {
          kind: "jira-search",
          more: found.length > limit,
          issues: found.slice(0, limit).map((raw) => {
            const issue = toIssue(raw);
            return { ...issue, summary: issue.summary.slice(0, 300) };
          }),
        };
        return Response.json(result);
      } catch (error) {
        return new Response(null, { status: error instanceof JiraError && error.status === 400 ? 400 : 502 });
      }
    },
  });
  return {
    env: { PRODUCTBOARD_JIRA_SEARCH_URL: server.url.href, PRODUCTBOARD_JIRA_SEARCH_TOKEN: token },
    close: () => server.stop(true),
  };
}
