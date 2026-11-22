import { z } from "zod";
import { Stage } from "../../src/jira/workflow";

export const JiraSearchInput = z.object({
  jql: z.string().trim().min(1).max(1200).describe("Jira Query Language, including an optional ORDER BY clause"),
  limit: z.number().int().min(1).max(50).default(25),
});

export const JiraSearchResult = z.object({
  kind: z.literal("jira-search"),
  more: z.boolean(),
  issues: z.array(
    z.object({
      key: z.string(),
      summary: z.string(),
      status: z.string(),
      category: z.enum(["new", "indeterminate", "done"]),
      stage: Stage.optional(),
      priority: z.string(),
      assigneeId: z.string(),
      assignee: z.string(),
      sprint: z.string(),
    }),
  ),
});
export type JiraSearchResult = z.infer<typeof JiraSearchResult>;

export const JIRA_SEARCH_ERRORS = {
  400: "Jira rejected the query. Check the JQL and try again.",
  401: "Jira rejected your API token. Run productboard --login to reconnect.",
  403: "You do not have permission to search these Jira issues.",
  429: "Jira is rate-limiting searches. Wait a minute and retry.",
  502: "Could not search Jira. Check your connection and try again.",
} as const;
