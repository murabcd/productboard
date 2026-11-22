import type { AgentChoice, AgentChoiceChange, ModelRef } from "../auth";
import type { Issue } from "../jira/types";
import { clean } from "../text";
import type { ChatArchive } from "./archive";
import type { ContextCheckpoint } from "./context";
import { type AgentTool, type Conversation, conversation, conversationData, type Turn } from "./conversation";
import type { SprintContext } from "./draft";
import type { AgentImage } from "./images";
import type { AgentModel } from "./models";

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
    if (this.current.turns.length === 0 && this.current.draft.parts.length === 0) return;
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
    const operation = { kind: "compaction", controller: new AbortController() } as const;
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
    } finally {
      thread.operation = undefined;
      this.changed(thread);
    }
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
    await backend?.close();
    await Promise.all(
      this.threads
        .filter((thread) => thread.turns.length || thread.draft.parts.length)
        .map((thread) => this.persist(thread)),
    );
  }

  async send(): Promise<void> {
    const thread = this.current;
    if (thread.operation) return;
    const { draft } = thread;
    const message = draft.prepare();
    if (!message) return;
    const parts = draft.parts;
    const { displayPrompt, ...request } = message;
    const backend = this.backend;
    if (!backend) {
      draft.error = "Connect Agent from the command palette (Ctrl+K).";
      this.redraw();
      return;
    }
    const pending = new AbortController();
    const turn: Turn = {
      id: crypto.randomUUID(),
      prompt: request.prompt,
      displayPrompt,
      answer: "",
      choice: backend.current,
      started: Date.now(),
      state: { kind: "running" },
      sprint: request.sprint,
      images: request.images,
      parts,
      issues: [],
      tools: [],
    };
    thread.operation = { kind: "reply", controller: pending };
    draft.replace([]);
    draft.error = "";
    thread.recall = undefined;
    if (!thread.turns.length && thread.name === "New chat") thread.name = clean(displayPrompt).slice(0, 80);
    thread.updated = Date.now();
    const history = thread.turns.slice();
    thread.turns.push(turn);
    this.changed(thread);
    let failure = "";
    let accepting = true;
    try {
      const reply = backend.ask({
        thread: thread.id,
        ...request,
        signal: pending.signal,
        history,
        checkpoint: thread.checkpoint,
        onIssues: (issues) => {
          if (!accepting || pending.signal.aborted) return;
          turn.issues.push(...issues);
          for (const issue of issues) thread.issues.set(issue.key, issue);
        },
        onText: (text, replace = false) => {
          if (!accepting || pending.signal.aborted) return;
          turn.answer = (replace ? "" : turn.answer) + clean(text, true);
          this.changed(thread);
        },
        onTools: (tools) => {
          if (!accepting || pending.signal.aborted) return;
          turn.tools = tools.map((tool) => ({
            ...tool,
            name: clean(tool.name),
            query: clean(tool.query),
            detail: clean(tool.detail),
          }));
          this.changed(thread);
        },
      });
      await untilStopped(reply, pending.signal);
      if (!turn.answer.trim()) throw new Error("Agent returned an empty reply.");
    } catch (error) {
      if (!pending.signal.aborted) failure = error instanceof Error ? clean(error.message) : "Agent request failed.";
    } finally {
      accepting = false;
      const finished = Date.now();
      turn.state = pending.signal.aborted
        ? { kind: "interrupted", finished }
        : failure
          ? { kind: "failed", finished, error: failure }
          : { kind: "complete", finished };
      turn.tools = turn.tools.map((tool) =>
        tool.state === "running"
          ? {
              ...tool,
              state: pending.signal.aborted ? "interrupted" : "failed",
              detail: pending.signal.aborted ? "Stopped" : "Did not finish",
            }
          : tool,
      );
      const answered = turn.answer.trim() !== "";
      if (pending.signal.aborted || failure) {
        if ((!answered || failure) && draft.parts.length === 0) draft.replace(parts);
        draft.error = pending.signal.aborted ? "Stopped." : failure;
      }
      thread.operation = undefined;
      this.changed(thread);
    }
  }
}

async function untilStopped<T>(reply: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const { promise, reject } = Promise.withResolvers<never>();
  const stop = () => reject(signal.reason);
  signal.addEventListener("abort", stop, { once: true });
  try {
    return await Promise.race([reply, promise]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
