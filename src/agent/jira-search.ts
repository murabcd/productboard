import { randomBytes } from "node:crypto";
import { JiraSearchInput, type JiraSearchResult } from "../../agent/lib/jira-search";
import type { JiraClient } from "../jira/client";
import { JiraError } from "../jira/http";

/** The local Eve process can search through the dashboard's existing Jira client. */
export function openJiraSearch(jira: Pick<JiraClient, "issuePage">) {
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
        const page = await jira.issuePage(jql, limit, {
          priority: "background",
          signal: request.signal,
        });
        const result: JiraSearchResult = {
          kind: "jira-search",
          ...page,
          issues: page.issues.map((issue) => ({ ...issue, summary: issue.summary.slice(0, 300) })),
        };
        return Response.json(result);
      } catch (error) {
        const status = error instanceof JiraError ? error.status : 0;
        return new Response(null, {
          status: status === 400 || status === 401 || status === 403 || status === 429 ? status : 502,
        });
      }
    },
  });
  return {
    env: { PRODUCTBOARD_JIRA_SEARCH_URL: server.url.href, PRODUCTBOARD_JIRA_SEARCH_TOKEN: token },
    close: () => server.stop(true),
  };
}
