import type { AgentChoice, AgentChoiceChange, ModelRef } from "../auth";
import type { Issue } from "../jira/types";
import { clean } from "../text";
import { AgentDraft, type DraftParts, type SprintContext } from "./draft";
import type { AgentImage } from "./images";
import type { AgentModel } from "./models";

export interface AgentBackend {
  /** The model and reasoning that answer, shown under each reply. */
  readonly current: AgentChoice;
  readonly recentModels: readonly ModelRef[];
  models(): Promise<AgentModel[]>;
  close(): Promise<void>;
  discardThread(thread: string): void;
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
    onText(text: string, replace?: boolean): void;
    onTools(tools: readonly AgentTool[]): void;
  }): Promise<void>;
}

export interface AgentTool {
  readonly id: string;
  readonly name: string;
  readonly query: string;
  readonly state: "running" | "completed" | "failed" | "interrupted";
  readonly detail: string;
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
  error?: string;
  readonly sprint?: SprintContext;
  readonly images: readonly AgentImage[];
  issues: Issue[];
  tools: readonly AgentTool[];
}

interface Conversation {
  id: string;
  turns: Turn[];
  issues: Map<string, Issue>;
  pending?: AbortController;
  draft: AgentDraft;
  prompts: DraftParts[];
  recall?: { index: number; draft: DraftParts; shown: DraftParts };
}

const conversation = (): Conversation => ({
  id: crypto.randomUUID(),
  turns: [],
  issues: new Map(),
  draft: new AgentDraft(),
  prompts: [],
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

  clear(): void {
    const thread = this.current;
    this.stop();
    this.backend?.discardThread(thread.id);
    this.active = conversation();
    this.threads[this.threads.indexOf(thread)] = this.active;
  }

  stop(): void {
    this.current.pending?.abort();
  }

  /** Recall only untouched history entries; keep the draft at the end. */
  recall(direction: -1 | 1): boolean {
    const thread = this.current;
    const { draft, prompts, recall } = thread;
    if (recall && recall.shown !== draft.parts) return false;
    const index = (recall?.index ?? prompts.length) + direction;
    if (index < 0 || index > prompts.length) return false;
    const saved = recall?.draft ?? draft.parts;
    const parts = index === prompts.length ? saved : prompts[index];
    if (!parts) return false;
    draft.replace(parts);
    thread.recall = index === prompts.length ? undefined : { index, draft: saved, shown: parts };
    return true;
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
      sprint: request.sprint,
      images: request.images,
      issues: [],
      tools: [],
    };
    thread.pending = pending;
    draft.replace([]);
    draft.error = "";
    thread.recall = undefined;
    if (thread.prompts.at(-1) !== parts) thread.prompts.push(parts);
    const history = thread.turns.slice();
    thread.turns.push(turn);
    let failure = "";
    let accepting = true;
    try {
      const reply = backend.ask({
        thread: thread.id,
        ...request,
        signal: pending.signal,
        history,
        onIssues: (issues) => {
          if (!accepting || pending.signal.aborted) return;
          turn.issues.push(...issues);
          for (const issue of issues) thread.issues.set(issue.key, issue);
        },
        onText: (text, replace = false) => {
          if (!accepting || pending.signal.aborted) return;
          turn.answer = (replace ? "" : turn.answer) + clean(text, true);
          this.redraw();
        },
        onTools: (tools) => {
          if (!accepting || pending.signal.aborted) return;
          turn.tools = tools.map((tool) => ({
            ...tool,
            name: clean(tool.name),
            query: clean(tool.query),
            detail: clean(tool.detail),
          }));
          this.redraw();
        },
      });
      await untilStopped(reply, pending.signal);
      if (!turn.answer.trim()) throw new Error("Agent returned an empty reply.");
    } catch (error) {
      if (!pending.signal.aborted) failure = error instanceof Error ? clean(error.message) : "Agent request failed.";
    } finally {
      accepting = false;
      turn.finished = Date.now();
      turn.error = failure || undefined;
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
      if (pending.signal.aborted) turn.interrupted = true;
      if (pending.signal.aborted || failure) {
        if ((!answered || failure) && draft.parts.length === 0) draft.replace(parts);
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
