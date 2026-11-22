import { z } from "zod";
import { JiraSearchResult } from "../../agent/lib/jira-search";
import { AgentChoice } from "../auth";
import { ContextCheckpoint } from "./context";
import { AgentDraft, DraftParts, DraftSnapshot, SprintContext } from "./draft";
import { FailureKind } from "./failure";
import { AgentImage } from "./images";
import { PromptQueue, QueuedPrompt } from "./queue";

export const AgentTool = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string(),
  state: z.enum(["running", "completed", "failed", "interrupted"]),
  detail: z.string(),
  limit: z.number().int().optional(),
  result: JiraSearchResult.optional(),
  error: z.string().optional(),
});
export type AgentTool = z.infer<typeof AgentTool>;

export const TurnState = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("running"),
    progress: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("answering"), attempt: z.number().int() }),
        z.object({ kind: z.literal("retrying"), attempt: z.number().int(), nextAt: z.number(), reason: z.string() }),
      ])
      .default({ kind: "answering", attempt: 1 }),
  }),
  z.object({ kind: z.literal("complete"), finished: z.number() }),
  z.object({ kind: z.literal("interrupted"), finished: z.number() }),
  z.object({
    kind: z.literal("failed"),
    finished: z.number(),
    error: z.string(),
    reason: FailureKind.default("unknown"),
  }),
]);
export const Turn = z.object({
  id: z.string().uuid(),
  prompt: z.string(),
  displayPrompt: z.string(),
  answer: z.string(),
  choice: AgentChoice,
  started: z.number(),
  state: TurnState,
  sprint: SprintContext.optional(),
  images: z.array(AgentImage).readonly(),
  parts: DraftParts,
  issues: JiraSearchResult.shape.issues,
  tools: z.array(AgentTool).readonly(),
});
export type Turn = z.infer<typeof Turn>;

export const ConversationData = z.object({
  id: z.string().uuid(),
  name: z.string(),
  updated: z.number(),
  turns: z.array(Turn),
  draft: DraftSnapshot,
  checkpoint: ContextCheckpoint.optional(),
  queue: z.array(QueuedPrompt).default([]),
});
export type ConversationData = z.infer<typeof ConversationData>;

export interface Conversation extends Omit<ConversationData, "draft" | "queue"> {
  draft: AgentDraft;
  queue: PromptQueue;
  issues: Map<string, JiraSearchResult["issues"][number]>;
  operation?: AgentOperation;
  recall?: { index: number; draft: DraftSnapshot; shown: DraftParts };
}

export class AgentOperation {
  readonly controller = new AbortController();
  private readonly completion = Promise.withResolvers<void>();
  readonly settled = this.completion.promise;
  constructor(readonly kind: "reply" | "compaction") {}
  finish(): void {
    this.completion.resolve();
  }
}

export function conversation(data?: ConversationData): Conversation {
  const turns = data?.turns ?? [];
  for (const turn of turns) {
    if (turn.state.kind === "running") turn.state = { kind: "interrupted", finished: Date.now() };
    turn.tools = turn.tools.map((tool) =>
      tool.state === "running" ? { ...tool, state: "interrupted", detail: "Stopped" } : tool,
    );
  }
  const draft = new AgentDraft();
  if (data) draft.restore(data.draft);
  return {
    id: data?.id ?? crypto.randomUUID(),
    name: data?.name ?? "New chat",
    updated: data?.updated ?? Date.now(),
    turns,
    checkpoint: data?.checkpoint,
    draft,
    queue: new PromptQueue(draft, data?.queue),
    issues: new Map(turns.flatMap((turn) => turn.issues.map((issue) => [issue.key, issue]))),
  };
}

export function conversationData(thread: Conversation): ConversationData {
  return {
    id: thread.id,
    name: thread.name,
    updated: thread.updated,
    turns: thread.turns,
    draft: thread.draft.snapshot(),
    checkpoint: thread.checkpoint,
    queue: [...thread.queue.entries],
  };
}
