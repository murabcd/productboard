import { z } from "zod";

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
      priority: z.string(),
      assigneeId: z.string(),
      assignee: z.string(),
      sprint: z.string(),
    }),
  ),
});
export type JiraSearchResult = z.infer<typeof JiraSearchResult>;
