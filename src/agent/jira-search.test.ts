import { expect, mock, test } from "bun:test";
import { JiraSearchResult } from "../../agent/lib/jira-search";
import { JiraClient } from "../jira/client";
import { JiraError, JiraHttp } from "../jira/http";
import { Workflow } from "../jira/workflow";
import { fakeFetch, issues, rawIssue } from "../testing";
import { openJiraSearch } from "./jira-search";

test("Eve can search across Jira through the authenticated bridge with bounded results", async () => {
  const issuePage = mock(async () => ({ issues: issues("EX-1", "WEB-1"), more: true }));
  const bridge = openJiraSearch({ issuePage });
  const { PRODUCTBOARD_JIRA_SEARCH_URL: url, PRODUCTBOARD_JIRA_SEARCH_TOKEN: token } = bridge.env;
  const query = "status = Blocked ORDER BY updated DESC";
  const request = (limit: number, credential = token) =>
    fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jql: query, limit }),
    });
  try {
    expect((await request(2, "wrong-token")).status).toBe(404);
    expect((await request(51)).status).toBe(400);
    expect(issuePage).not.toHaveBeenCalled();

    const response = await request(2);
    expect(response.ok).toBe(true);
    expect(issuePage).toHaveBeenCalledWith(query, 2, {
      priority: "background",
      signal: expect.any(AbortSignal),
    });
    const result = JiraSearchResult.parse(await response.json());
    expect(result.more).toBe(true);
    expect(result.issues.map(({ key }) => key)).toEqual(["EX-1", "WEB-1"]);
  } finally {
    await bridge.close();
  }
});

test("Agent search retains the site's workflow stage through the validated result", async () => {
  const raw = rawIssue("TEAM-42", "indeterminate");
  raw.fields.status.name = "На проверке";
  const http = new JiraHttp(
    { site: "example.atlassian.net", email: "test@example.com", token: "test-token" },
    fakeFetch(async (input) =>
      Response.json(new URL(String(input)).pathname.endsWith("/field") ? [] : { issues: [raw], isLast: true }),
    ),
  );
  const bridge = openJiraSearch(new JiraClient(http, Workflow.parse({ statuses: { "На проверке": "In review" } })));
  try {
    const response = await fetch(bridge.env.PRODUCTBOARD_JIRA_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bridge.env.PRODUCTBOARD_JIRA_SEARCH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jql: "project = TEAM" }),
    });
    expect(response.ok).toBe(true);
    const result = JiraSearchResult.parse(await response.json());
    expect(result.issues[0]).toMatchObject({ key: "TEAM-42", status: "На проверке", stage: "In review" });
  } finally {
    await bridge.close();
    http.close();
  }
});

test.each([400, 401, 403, 429, 500])(
  "Jira search preserves actionable status %i without returning credentials or server bodies",
  async (status) => {
    const bridge = openJiraSearch({
      issuePage: async () => {
        throw new JiraError("private upstream body", status);
      },
    });
    try {
      const response = await fetch(bridge.env.PRODUCTBOARD_JIRA_SEARCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bridge.env.PRODUCTBOARD_JIRA_SEARCH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jql: "project = EX" }),
      });
      expect(response.status).toBe(status === 500 ? 502 : status);
      expect(await response.text()).toBe("");
    } finally {
      await bridge.close();
    }
  },
);
