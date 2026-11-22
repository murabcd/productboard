import { defaultMessageReducer, type EveDynamicToolPart, type MessageStreamEvent } from "eve/client";
import { JiraSearchInput, JiraSearchResult } from "../../agent/lib/jira-search";
import type { AgentBackend, AgentTool } from "./chat";

type Callbacks = Pick<Parameters<AgentBackend["ask"]>[0], "onText" | "onTools" | "onIssues">;

/** Let Eve own stream reconciliation, including authoritative text after a retry. */
export class EveStream {
  private readonly reducer = defaultMessageReducer();
  private data = this.reducer.initial();
  private answer = "";

  constructor(private readonly callbacks: Callbacks) {}

  accept(event: MessageStreamEvent): void {
    this.data = this.reducer.reduce(this.data, event);
    const parts = this.data.messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.parts);
    if (event.type === "message.appended" || event.type === "message.completed") {
      const answer = parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n\n");
      if (answer !== this.answer) {
        this.answer = answer;
        this.callbacks.onText(answer, true);
      }
    }
    if (event.type === "actions.requested" || event.type === "action.result") {
      this.callbacks.onTools(parts.filter((part) => part.type === "dynamic-tool").map(toolProgress));
    }
    if (event.type === "action.result" && event.data.result.kind === "tool-result" && !event.data.result.isError) {
      const result = JiraSearchResult.safeParse(event.data.result.output);
      if (result.success) this.callbacks.onIssues(result.data.issues);
    }
  }
}

function toolProgress(part: EveDynamicToolPart): AgentTool {
  const input = JiraSearchInput.safeParse(part.input);
  const result = JiraSearchResult.safeParse(part.output);
  const failed = part.state === "output-error" || part.state === "output-denied";
  const completed = part.state === "output-available" && !part.partial;
  return {
    id: part.toolCallId,
    name: part.toolName === "search_jira" ? "Search Jira" : part.toolName,
    query: input.success ? input.data.jql : "",
    state: failed ? "failed" : completed ? "completed" : "running",
    detail: failed
      ? "Search failed"
      : result.success
        ? `${result.data.issues.length} issues${result.data.more ? " · more available" : ""}`
        : completed
          ? "Done"
          : "Searching…",
  };
}
