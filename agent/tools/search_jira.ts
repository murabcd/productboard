import { defineTool } from "eve/tools";
import { JiraSearchInput, JiraSearchResult } from "../lib/jira-search";

export default defineTool({
  description:
    "Find issues across Jira using JQL. Search by issue key, text, status, project, assignee, sprint or dates. " +
    "Results contain current issue summaries and fields. If more is true, narrow the query or describe the result as partial.",
  inputSchema: JiraSearchInput,
  outputSchema: JiraSearchResult,
  async execute(input, { abortSignal }) {
    const { PRODUCTBOARD_JIRA_SEARCH_URL: url, PRODUCTBOARD_JIRA_SEARCH_TOKEN: token } = process.env;
    if (!url || !token) throw new Error("Jira search is unavailable. Start Agent from Productboard.");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      redirect: "error",
      signal: abortSignal,
    });
    if (response.status === 400) throw new Error("Jira rejected the query. Check the JQL and try again.");
    if (!response.ok) throw new Error("Could not search Jira. Check your Jira connection and permissions.");
    return JiraSearchResult.parse(await response.json());
  },
  toModelOutput({ issues, more }) {
    return {
      type: "json",
      value: {
        more,
        issues: issues.map(({ key, summary, status, category, priority, assignee, sprint }) => ({
          key,
          summary,
          status,
          category,
          priority,
          assignee,
          sprint,
        })),
      },
    };
  },
});
