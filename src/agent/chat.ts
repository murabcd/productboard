import type { AgentChoice, AgentChoiceChange, ModelRef } from "../auth";
import type { Issue } from "../jira/types";
import { clean } from "../text";
import { AgentDraft, type SprintContext } from "./draft";
import type { AgentImage } from "./images";
import type { AgentModel } from "./models";

export interface AgentBackend {
  /** The model and reasoning that answer, shown under each reply. */
  readonly current: AgentChoice;
  readonly recentModels: readonly ModelRef[];
  models(): Promise<AgentModel[]>;
  close(): Promise<void>;
  /** Answer with another model or reasoning from now on. */
  use(choice: AgentChoice, change: AgentChoiceChange): Promise<void>;
  ask(request: {
    thread: string;
    prompt: string;
    sprint?: SprintContext;
    images: readonly AgentImage[];
    signal: AbortSignal;
    history: readonly Turn[];
    onIssues(issues: Issue[]): void;
    onText(delta: string): void;
  }): Promise<void>;
}

export interface Turn {
  readonly prompt: string;
  readonly displayPrompt: string;
  answer: string;
  readonly choice: AgentChoice;
  /** When it was sent and when the reply ended, in milliseconds. */
  readonly started: number;
  finished?: number;
  interrupted?: boolean;
}

interface Conversation {
  id: string;
  turns: Turn[];
  issues: Map<string, Issue>;
  pending?: AbortController;
  draft: AgentDraft;
  scroll: number;
}

const conversation = (): Conversation => ({
  id: crypto.randomUUID(),
  turns: [],
  issues: new Map(),
  draft: new AgentDraft(),
  scroll: 0,
});

type Connection = { kind: "offline" | "connecting" | "closed" } | { kind: "online"; backend: AgentBackend };

export class AgentChat {
  private active = conversation();
  private readonly threads = [this.active];
  private connection: Connection;

  constructor(
    backend: AgentBackend | undefined,
    private readonly redraw: () => void,
  ) {
    this.connection = backend ? { kind: "online", backend } : { kind: "offline" };
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
    if (this.current.turns.length === 0) return;
    this.active = conversation();
    this.threads.push(this.active);
  }

  stop(): void {
    this.current.pending?.abort();
  }

  async dispose(): Promise<void> {
    const backend = this.backend;
    this.connection = { kind: "closed" };
    for (const thread of this.threads) thread.pending?.abort();
    await backend?.close();
  }

  async send(): Promise<void> {
    const thread = this.current;
    if (thread.pending) return;
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
      prompt: request.prompt,
      displayPrompt,
      answer: "",
      choice: backend.current,
      started: Date.now(),
    };
    thread.pending = pending;
    draft.replace([]);
    draft.error = "";
    thread.scroll = 0;
    const history = thread.turns.slice(-6);
    thread.turns.push(turn);
    let failure = "";
    try {
      const reply = backend.ask({
        thread: thread.id,
        ...request,
        signal: pending.signal,
        history,
        onIssues: (issues) => {
          if (!pending.signal.aborted) for (const issue of issues) thread.issues.set(issue.key, issue);
        },
        onText: (delta) => {
          if (pending.signal.aborted) return;
          turn.answer += clean(delta, true);
          this.redraw();
        },
      });
      await untilStopped(reply, pending.signal);
      if (!turn.answer.trim()) throw new Error("Agent returned an empty reply.");
    } catch (error) {
      if (!pending.signal.aborted) failure = error instanceof Error ? clean(error.message) : "Agent request failed.";
    } finally {
      turn.finished = Date.now();
      const answered = turn.answer.trim() !== "";
      if (pending.signal.aborted && answered) turn.interrupted = true;
      else if (pending.signal.aborted || failure) {
        if (!answered) thread.turns.pop();
        if (draft.parts.length === 0) draft.replace(parts);
        draft.error = pending.signal.aborted ? "Stopped." : failure;
      }
      thread.pending = undefined;
      this.redraw();
    }
  }
}

async function untilStopped(reply: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const { promise, reject } = Promise.withResolvers<never>();
  const stop = () => reject(signal.reason);
  signal.addEventListener("abort", stop, { once: true });
  try {
    await Promise.race([reply, promise]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
