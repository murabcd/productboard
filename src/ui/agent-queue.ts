import type { Conversation } from "../agent/conversation";
import { draftText } from "../agent/draft";
import type { Canvas } from "./canvas";
import { buttonsRight, type Control, controlsWidth } from "./controls";
import type { AgentLayout } from "./layout";

export function drawQueue(
  canvas: Canvas,
  thread: Conversation,
  { left, transcript: { room }, queue }: AgentLayout,
): void {
  if (!thread.queue.length) return;
  const right = left + room;
  const controls: Control[] = [{ label: "Manage", target: { kind: "agent-queue", action: "manage" } }];
  if (!thread.operation) controls.push({ label: "Resume", target: { kind: "agent-queue", action: "resume" } });
  const end = buttonsRight(canvas, queue.top, right, controls);
  canvas.put(queue.top, left + 3, `Queued follow-ups (${thread.queue.length})`, "muted", end - left - 4);
  for (const [index, item] of thread.queue.entries.slice(0, queue.rows - 1).entries()) {
    const row = queue.top + index + 1;
    const actions: Control[] = [
      ...(item.kind === "ready"
        ? [{ label: "Edit", target: { kind: "agent-queue", action: "edit", id: item.id } } satisfies Control]
        : []),
      { label: "Cancel", target: { kind: "agent-queue", action: "cancel", id: item.id } },
    ];
    buttonsRight(canvas, row, right, actions);
    const text =
      item.kind === "editing"
        ? `Editing: ${draftText(thread.draft.parts)}`
        : `${index + 1}. ${draftText(item.draft.parts)}`;
    canvas.put(row, left + 3, text, "muted", room - controlsWidth(actions) - 5);
  }
}
