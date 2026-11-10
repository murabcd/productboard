import { type CliRenderer, TextareaRenderable } from "@opentui/core";
import type { AgentChat } from "../agent/chat";
import { type Draft, type DraftAttachment, type DraftReference, draftText } from "../agent/draft";
import { pastedImagePath } from "../agent/images";
import { shortSprintName } from "../jira/types";
import { clean } from "../text";
import type { resolveTheme } from "./theme";

export class AgentComposer extends TextareaRenderable {
  private readonly attachments = new WeakMap<object, DraftAttachment>();
  private thread?: AgentChat["current"];
  private draft?: Draft;
  private updating = false;
  private attachmentNumber = 0;

  constructor(
    renderer: CliRenderer,
    private readonly chat: AgentChat,
    style: ReturnType<typeof resolveTheme>["composer"],
    changed: () => void,
  ) {
    super(renderer, {
      id: "composer",
      position: "absolute",
      visible: false,
      wrapMode: "word",
      ...style,
      placeholder: chat.configured ? "Message Agent… (@ for context)" : "Agent is not set up",
      keyBindings: [
        { name: "return", action: "submit" },
        { name: "kpenter", action: "submit" },
        { name: "return", shift: true, action: "newline" },
        { name: "linefeed", action: "newline" },
      ],
      onContentChange: () => {
        if (!this.updating) this.save();
        changed();
      },
      onSubmit: () => {
        this.sync();
        void chat.send();
        this.sync();
        changed();
      },
    });
  }

  sync(): void {
    const thread = this.chat.current;
    if (this.thread === thread && this.draft === thread.draft) return;
    const cursor = this.thread === thread ? this.cursorOffset : 0;
    const removed = this.extmarks.getAll().reduce((cells, { start, end, data }) => {
      const attachment = this.markedAttachment(data);
      return attachment?.kind === "image" && attachment.state.kind === "failed" && !thread.draft.includes(attachment)
        ? cells + Math.max(0, Math.min(end, cursor) - start)
        : cells;
    }, 0);
    this.thread = thread;
    this.draft = thread.draft;
    this.updating = true;
    this.setText(draftText(thread.draft));
    let offset = 0;
    for (const part of thread.draft) {
      const end = offset + this.editBuffer.measureText(typeof part === "string" ? part : part.label);
      if (typeof part !== "string") this.mark(part, offset, end);
      offset = end;
    }
    this.cursorOffset = Math.min(cursor - removed, offset);
    this.updating = false;
  }

  canMention(): boolean {
    const before = this.getTextRange(0, this.cursorOffset);
    return !before || before.trimEnd() !== before;
  }

  attachReference(reference: DraftReference): void {
    this.sync();
    if (reference.kind === "sprint") {
      const previous = this.extmarks.getAll().find(({ data }) => this.markedAttachment(data)?.kind === "sprint");
      if (previous) {
        const cursor = this.cursorOffset;
        this.updating = true;
        this.setSelection(previous.start, previous.end);
        this.deleteSelection();
        this.cursorOffset = cursor - Math.max(0, Math.min(cursor, previous.end) - previous.start);
      }
    }
    const spacer = this.canMention() ? "" : " ";
    const name = reference.kind === "sprint" ? clean(shortSprintName(reference.sprint.name)) : reference.key;
    this.insert({ ...reference, label: `${spacer}@${name}` });
  }

  paste(text: string): boolean {
    this.sync();
    const path = pastedImagePath(text);
    const pasted = text.replace(/\r\n?/g, "\n");
    const breaks = pasted.split("\n").length - 1;
    if (!path && (!pasted.trim() || (breaks === 0 && pasted.length <= 200))) return false;

    const number = ++this.attachmentNumber;
    const spacer = this.canMention() ? "" : " ";
    if (path) {
      void this.chat.attachImage(path, `${spacer}[Image #${number}]`, (attachment) => this.insert(attachment));
    } else {
      const label = `${spacer}[Pasted text #${number}${breaks ? ` +${breaks} ${breaks === 1 ? "line" : "lines"}` : ""}]`;
      this.insert({ kind: "paste", label, text: pasted });
    }
    return true;
  }

  private insert(attachment: DraftAttachment): void {
    this.updating = true;
    this.insertText(attachment.label);
    const end = this.cursorOffset;
    this.mark(attachment, end - this.editBuffer.measureText(attachment.label), end);
    this.updating = false;
    this.save();
  }

  private mark(attachment: DraftAttachment, start: number, end: number): void {
    const ref = {};
    this.attachments.set(ref, attachment);
    this.extmarks.create({ start, end, virtual: true, data: ref });
  }

  private markedAttachment(data: unknown): DraftAttachment | undefined {
    return data && typeof data === "object" ? this.attachments.get(data) : undefined;
  }

  private save(): void {
    if (!this.thread) return;
    const parts: (string | DraftAttachment)[] = [];
    let offset = 0;
    for (const { start, end, data } of this.extmarks.getAll().sort((a, b) => a.start - b.start)) {
      const attachment = this.markedAttachment(data);
      if (!attachment || this.getTextRange(start, end) !== attachment.label) continue;
      if (offset < start) parts.push(this.getTextRange(offset, start));
      parts.push(attachment);
      offset = end;
    }
    const end = this.editBuffer.measureText(this.plainText);
    if (offset < end) parts.push(this.getTextRange(offset, end));
    this.thread.draft = this.draft = parts;
  }
}
