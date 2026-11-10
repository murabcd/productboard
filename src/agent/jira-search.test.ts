import { expect, mock, test } from "bun:test";
import { JiraSearchResult } from "../../agent/lib/jira-search";
import { LIST_FIELDS } from "../jira/parse";
import { rawIssue } from "../testing";
import { openJiraSearch } from "./jira-search";

test("Eve can search across Jira through the authenticated bridge with bounded results", async () => {
  const search = mock(async () => [rawIssue("EX-1"), rawIssue("WEB-1"), rawIssue("OPS-1")]);
  const bridge = openJiraSearch({ search });
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
    expect(search).not.toHaveBeenCalled();

    const response = await request(2);
    expect(response.ok).toBe(true);
    expect(search).toHaveBeenCalledWith(query, LIST_FIELDS, 3, {
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
