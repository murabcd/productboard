import { isDeepStrictEqual } from "node:util";
import type { AgentChoice, AgentChoiceChange, ModelRef } from "../auth";
import type { Issue } from "../jira/types";
import { clean } from "../text";
import type { ChatArchive } from "./archive";
import type { ContextCheckpoint } from "./context";
import {
  AgentOperation,
  type AgentTool,
  type Conversation,
  conversation,
  conversationData,
  type Turn,
} from "./conversation";
import { AgentDraft, type SprintContext } from "./draft";
import type { AgentImage } from "./images";
import type { AgentModel } from "./models";
import { runReply, untilStopped } from "./reply";

export type { AgentTool, Turn } from "./conversation";

export interface AgentBackend {
  /** The model and reasoning that answer, shown under each reply. */
  readonly current: AgentChoice;
  readonly recentModels: readonly ModelRef[];
  models(): Promise<AgentModel[]>;
  close(): Promise<void>;
  discardThread(thread: string): void;
  compact(request: { history: readonly Turn[]; checkpoint?: ContextCheckpoint; signal: AbortSignal }): Promise<string>;
  /** Answer with another model or reasoning from now on. */
  use(choice: AgentChoice, change: AgentChoiceChange): Promise<void>;
  ask(request: {
    thread: string;
    prompt: string;
    sprint?: SprintContext;
    images: readonly AgentImage[];
    signal: AbortSignal;
    history: readonly Turn[];
    checkpoint?: ContextCheckpoint;
    onIssues(issues: Issue[]): void;
    onText(text: string, replace?: boolean): void;
    onTools(tools: readonly AgentTool[]): void;
  }): Promise<void>;
}

type Connection = { kind: "offline" | "connecting" | "closed" } | { kind: "online"; backend: AgentBackend };

export class AgentChat {
  private active = conversation();
  private readonly threads = [this.active];
  private connection: Connection;
  private readonly saves = new Map<Conversation, ReturnType<typeof setTimeout>>();
  storageError = "";

  constructor(
    backend: AgentBackend | undefined,
    private readonly redraw: () => void,
    private readonly archive?: ChatArchive,
  ) {
    this.connection = backend ? { kind: "online", backend } : { kind: "offline" };
    if (archive?.entries.length) {
      this.threads.splice(0, 1, ...archive.entries.map(conversation));
      this.active = this.threads.at(-1) ?? this.active;
    }
    this.storageError = archive?.error ?? "";
  }

  get current(): Conversation {
    return this.active;
  }

  get history(): string {
    return `${this.threads.indexOf(this.active) + 1}/${this.threads.length}`;
  }

  get size(): number {
    return this.threads.length;
  }

  get conversations(): readonly Conversation[] {
    return this.threads;
  }

  open(id: string): void {
    const thread = this.threads.find((thread) => thread.id === id);
    if (thread) this.active = thread;
  }

  rename(name: string): void {
    const value = clean(name).trim();
    if (value) this.current.name = value.slice(0, 120);
    this.changed();
  }

  fork(turnId: string): void {
    const original = this.current;
    const index = original.turns.findIndex((turn) => turn.id === turnId && turn.state.kind !== "running");
    if (index < 0) return;
    const turns = structuredClone(original.turns.slice(0, index + 1));
    this.active = conversation({
      id: crypto.randomUUID(),
      name: `${original.name} (fork)`,
      updated: Date.now(),
      turns,
      draft: { parts: [], images: [] },
      queue: [],
      checkpoint: turns.some((turn) => turn.id === original.checkpoint?.through)
        ? structuredClone(original.checkpoint)
        : undefined,
    });
    this.threads.push(this.active);
    this.changed();
  }

  delete(): void {
    const thread = this.current;
    this.retire(thread);
    const index = this.threads.indexOf(thread);
    this.threads.splice(index, 1);
    if (!this.threads.length) this.threads.push(conversation());
    this.active = this.threads[Math.min(index, this.threads.length - 1)] ?? this.active;
    this.redraw();
  }

  private retire(thread: Conversation): void {
    thread.operation?.controller.abort();
    this.backend?.discardThread(thread.id);
    clearTimeout(this.saves.get(thread));
    this.saves.delete(thread);
    void this.archive?.remove(thread.id).catch(() => this.storageFailed());
  }

  changed(thread = this.current): void {
    this.redraw();
    if (!this.archive || !this.threads.includes(thread) || this.connection.kind === "closed" || this.saves.has(thread))
      return;
    this.saves.set(
      thread,
      setTimeout(() => {
        this.saves.delete(thread);
        void this.persist(thread);
      }, 500),
    );
  }

  private async persist(thread: Conversation): Promise<void> {
    try {
      await this.archive?.save(conversationData(thread));
    } catch {
      this.storageFailed();
    }
  }

  private storageFailed(): void {
    this.storageError = "Could not save chats. Check local disk space and permissions.";
    this.redraw();
  }

  get configured(): boolean {
    return this.connection.kind === "online";
  }

  get canConnect(): boolean {
    return this.connection.kind === "offline";
  }

  get backend(): AgentBackend | undefined {
    return this.connection.kind === "online" ? this.connection.backend : undefined;
  }

  async connect(start: () => Promise<AgentBackend | undefined>): Promise<boolean> {
    if (!this.canConnect) return false;
    const connecting: Connection = { kind: "connecting" };
    this.connection = connecting;
    try {
      const backend = await start();
      if (this.connection !== connecting) {
        await backend?.close();
        return false;
      }
      if (!backend) return false;
      this.connection = { kind: "online", backend };
      this.current.draft.error = "";
      this.redraw();
      return true;
    } finally {
      if (this.connection === connecting) this.connection = { kind: "offline" };
    }
  }

  select(delta: number): void {
    const next = this.threads[this.threads.indexOf(this.active) + delta];
    if (next) this.active = next;
  }

  start(): void {
    if (this.current.turns.length === 0 && this.current.draft.parts.length === 0 && !this.current.queue.length) return;
    this.active = conversation();
    this.threads.push(this.active);
  }

  clear(): void {
    const index = this.threads.indexOf(this.current);
    this.retire(this.current);
    this.active = conversation();
    this.threads.splice(index, 1, this.active);
    this.redraw();
  }

  stop(): void {
    this.current.operation?.controller.abort();
  }

  async compact(): Promise<void> {
    const thread = this.current;
    const backend = this.backend;
    const last = thread.turns.at(-1);
    if (thread.operation || !backend || !last) return;
    const operation = new AgentOperation("compaction");
    thread.operation = operation;
    thread.draft.error = "";
    this.redraw();
    try {
      const summary = await untilStopped(
        backend.compact({ history: thread.turns, checkpoint: thread.checkpoint, signal: operation.controller.signal }),
        operation.controller.signal,
      );
      thread.checkpoint = { through: last.id, summary, created: Date.now() };
      backend.discardThread(thread.id);
    } catch (error) {
      thread.draft.error = operation.controller.signal.aborted
        ? "Compaction stopped. Previous context kept."
        : error instanceof Error
          ? clean(error.message)
          : "Compaction failed. Previous context kept.";
      return;
    } finally {
      thread.operation = undefined;
      operation.finish();
      this.changed(thread);
    }
    await this.drain(thread);
  }

  /** Recall only untouched history entries; keep the draft at the end. */
  recall(direction: -1 | 1): boolean {
    const thread = this.current;
    const { draft, turns, recall } = thread;
    if (recall && recall.shown !== draft.parts) return false;
    const index = (recall?.index ?? turns.length) + direction;
    if (index < 0 || index > turns.length) return false;
    const saved = recall?.draft ?? draft.snapshot();
    const value = index === turns.length ? saved : turns[index];
    if (!value) return false;
    draft.restore(value);
    thread.recall = index === turns.length ? undefined : { index, draft: saved, shown: draft.parts };
    this.changed();
    return true;
  }

  async dispose(): Promise<void> {
    const backend = this.backend;
    this.connection = { kind: "closed" };
    for (const thread of this.threads) thread.operation?.controller.abort();
    for (const timer of this.saves.values()) clearTimeout(timer);
    this.saves.clear();
    await Promise.all([backend?.close(), ...this.threads.map((thread) => thread.operation?.settled)]);
    await Promise.all(
      this.threads
        .filter((thread) => thread.turns.length || thread.draft.parts.length || thread.queue.length)
        .map((thread) => this.persist(thread)),
    );
  }

  send(): Promise<void> {
    const thread = this.current;
    if (thread.operation || thread.queue.entries.some((item) => item.kind === "editing")) {
      thread.queue.enqueue();
      this.changed(thread);
      return thread.operation ? Promise.resolve() : this.drain(thread);
    }
    return this.submit(this.current, this.current.draft);
  }

  editQueued(id: string): void {
    this.current.queue.edit(id);
    this.changed();
  }

  cancelQueued(id: string): void {
    this.current.queue.cancel(id);
    this.changed();
  }

  resumeQueue(): Promise<void> {
    return this.drain(this.current);
  }

  private async drain(thread: Conversation): Promise<void> {
    if (!this.configured || !this.threads.includes(thread) || thread.operation) return;
    const snapshot = thread.queue.take();
    if (!snapshot) return;
    const draft = new AgentDraft();
    draft.restore(snapshot);
    await this.submit(thread, draft);
  }

  async sendNow(): Promise<void> {
    const thread = this.current;
    if (!this.configured) return this.submit(thread, thread.draft);
    if (!thread.draft.prepare()) return;
    const snapshot = thread.draft.snapshot();
    thread.queue.cancelEditing();
    const operation = thread.operation;
    operation?.controller.abort();
    await operation?.settled;
    if (!this.threads.includes(thread) || !this.configured) return;
    if (isDeepStrictEqual(thread.draft.snapshot(), snapshot)) thread.draft.replace([]);
    const draft = new AgentDraft();
    draft.restore(snapshot);
    await this.submit(thread, draft);
  }

  retry(turnId: string): Promise<void> {
    const turn = this.current.turns.find((turn) => turn.id === turnId);
    if (this.current.operation || !turn || (turn.state.kind !== "failed" && turn.state.kind !== "interrupted"))
      return Promise.resolve();
    if (turn !== this.current.turns.at(-1)) this.fork(turn.id);
    if (isDeepStrictEqual(this.current.draft.snapshot(), { parts: turn.parts, images: turn.images }))
      this.current.draft.replace([]);
    const draft = new AgentDraft();
    draft.restore(turn);
    return this.submit(this.current, draft);
  }

  private async submit(thread: Conversation, draft: AgentDraft): Promise<void> {
    if (thread.operation) return;
    const message = draft.prepare();
    if (!message) return;
    const parts = draft.parts;
    const { displayPrompt, ...request } = message;
    const backend = this.backend;
    if (!backend) {
      thread.draft.error = "Connect Agent from the command palette (Ctrl+K).";
      this.redraw();
      return;
    }
    const operation = new AgentOperation("reply");
    const pending = operation.controller;
    const turn: Turn = {
      id: crypto.randomUUID(),
      prompt: request.prompt,
      displayPrompt,
      answer: "",
      choice: backend.current,
      started: Date.now(),
      state: { kind: "running", progress: { kind: "answering", attempt: 1 } },
      sprint: request.sprint,
      images: request.images,
      parts,
      issues: [],
      tools: [],
    };
    thread.operation = operation;
    draft.replace([]);
    thread.draft.error = "";
    thread.recall = undefined;
    if (!thread.turns.length && thread.name === "New chat") thread.name = clean(displayPrompt).slice(0, 80);
    thread.updated = Date.now();
    thread.turns.push(turn);
    this.changed(thread);
    await runReply(backend, thread, turn, pending.signal, () => this.changed(thread));
    if (turn.state.kind === "failed" || turn.state.kind === "interrupted") {
      if ((!turn.answer.trim() || turn.state.kind === "failed") && thread.draft.parts.length === 0)
        thread.draft.restore(turn);
      thread.draft.error = turn.state.kind === "failed" ? turn.state.error : "Stopped.";
    }
    thread.operation = undefined;
    operation.finish();
    this.changed(thread);
    if (turn.state.kind === "complete") await this.drain(thread);
  }
}
