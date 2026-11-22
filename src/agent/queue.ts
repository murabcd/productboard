import { z } from "zod";
import { type AgentDraft, DraftSnapshot } from "./draft";

export const QueuedPrompt = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), id: z.uuid(), draft: DraftSnapshot }),
  z.object({ kind: z.literal("editing"), id: z.uuid() }),
]);
export type QueuedPrompt = z.infer<typeof QueuedPrompt>;

/** An editing placeholder keeps order; its content lives only in the composer. */
export class PromptQueue {
  constructor(
    private readonly composer: AgentDraft,
    private readonly items: QueuedPrompt[] = [],
  ) {}
  get entries(): readonly QueuedPrompt[] {
    return this.items;
  }
  get length(): number {
    return this.items.length;
  }

  enqueue(): boolean {
    if (!this.composer.prepare()) return false;
    const index = this.items.findIndex((item) => item.kind === "editing");
    const item: QueuedPrompt = {
      kind: "ready",
      id: this.items[index]?.id ?? crypto.randomUUID(),
      draft: this.composer.snapshot(),
    };
    if (index < 0) this.items.push(item);
    else this.items.splice(index, 1, item);
    this.composer.replace([]);
    this.composer.error = "";
    return true;
  }

  edit(id: string): void {
    const index = this.items.findIndex((item) => item.id === id);
    const item = this.items[index];
    if (!item || item.kind === "editing") return;
    if (this.composer.parts.length || this.items.some((item) => item.kind === "editing")) {
      this.composer.error = "Finish or clear your draft before editing a queued message.";
      return;
    }
    this.composer.restore(item.draft);
    this.items.splice(index, 1, { kind: "editing", id });
  }

  cancel(id: string): void {
    const index = this.items.findIndex((item) => item.id === id);
    if (index >= 0) this.items.splice(index, 1);
  }

  cancelEditing(): void {
    const editing = this.items.find((item) => item.kind === "editing");
    if (editing) this.cancel(editing.id);
  }

  take(): DraftSnapshot | undefined {
    const first = this.items[0];
    if (!first || first.kind === "editing") return;
    this.items.shift();
    return first.draft;
  }
}
