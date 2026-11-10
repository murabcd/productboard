import { type CliRenderer, TextareaRenderable } from "@opentui/core";
import type { AgentChat } from "../agent/chat";
import { type Draft, type DraftAttachment, draftText } from "../agent/draft";
import { pastedImagePath } from "../agent/images";
import type { resolveTheme } from "./theme";

const END_OF_WORD = /\S$/;

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
      placeholder: chat.configured ? "Message Agent…" : "Agent is not set up",
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
      if (typeof part === "string") offset += this.editBuffer.measureText(part);
      else {
        this.mark(part, offset);
        offset += part.label.length;
      }
    }
    this.cursorOffset = Math.min(cursor - removed, offset);
    this.updating = false;
  }

  paste(text: string): boolean {
    this.sync();
    const path = pastedImagePath(text);
    const pasted = text.replace(/\r\n?/g, "\n");
    const breaks = pasted.split("\n").length - 1;
    if (!path && (!pasted.trim() || (breaks === 0 && pasted.length <= 200))) return false;

    const number = ++this.attachmentNumber;
    const spacer = END_OF_WORD.test(this.getTextRange(0, this.cursorOffset)) ? " " : "";
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
    this.mark(attachment, this.cursorOffset - attachment.label.length);
    this.updating = false;
    this.save();
  }

  private mark(attachment: DraftAttachment, start: number): void {
    const ref = {};
    this.attachments.set(ref, attachment);
    this.extmarks.create({ start, end: start + attachment.label.length, virtual: true, data: ref });
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
