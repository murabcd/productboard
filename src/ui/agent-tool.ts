import type { AgentTool } from "../agent/conversation";
import { type DocBlock, textBlock } from "../jira/adf";
import type { Panel } from "./panel";

export function toolPanel(tool: AgentTool): Panel {
  const body: DocBlock[] = [textBlock(`${tool.state} · ${tool.detail}`, tool.state === "failed" ? "error" : "muted")];
  if (tool.query) body.push({ kind: "pre", text: tool.query });
  if (tool.limit) body.push(textBlock(`Requested limit: ${tool.limit}`, "muted"));
  if (tool.error) body.push(textBlock(tool.error, "error"));
  if (tool.result) {
    body.push(
      textBlock(
        tool.result.more ? "More matches exist. Narrow the query for a complete result." : "All matches returned.",
        "muted",
      ),
    );
    body.push(
      ...tool.result.issues.map((issue) =>
        textBlock(
          `${issue.key} · ${issue.summary}\n${issue.status} · ${issue.assignee || "Unassigned"} · ${issue.priority}${issue.sprint ? ` · ${issue.sprint}` : ""}`,
        ),
      ),
    );
    if (!tool.result.issues.length) body.push(textBlock("No matching issues."));
  }
  return { kind: "text", title: tool.name, body, scroll: 0 };
}
