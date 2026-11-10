import type { AgentChoice } from "../auth";
import type { Issue } from "../jira/types";
import { clean } from "../text";
import type { AgentModel } from "./models";

export interface AgentScope {
  sprint: number;
  label: string;
}

export interface AgentBackend {
  /** The model and reasoning that answer, shown under each reply. */
  readonly current: AgentChoice;
  models(): Promise<AgentModel[]>;
  /** Answer with another model or reasoning from now on. */
  use(choice: AgentChoice): Promise<void>;
  ask(request: {
    scope: AgentScope;
    thread: string;
    prompt: string;
    signal: AbortSignal;
    history: readonly Turn[];
    onIssues(issues: Issue[]): void;
    onText(delta: string): void;
  }): Promise<void>;
}

export interface Turn {
  prompt: string;
  answer: string;
  choice: AgentChoice;
  /** When it was sent and when the reply ended, in milliseconds. */
  started: number;
  finished?: number;
  interrupted?: boolean;
}

interface Conversation {
  id: string;
  turns: Turn[];
  issues: Map<string, Issue>;
  pending?: AbortController;
  draft: string;
  error: string;
  scroll: number;
}

const conversation = (): Conversation => ({
  id: crypto.randomUUID(),
  turns: [],
  issues: new Map(),
  draft: "",
  error: "",
  scroll: 0,
});

export class AgentChat {
  private active = conversation();
  private readonly threads = [this.active];

  constructor(
    private readonly backend: AgentBackend | undefined,
    private readonly redraw: () => void,
  ) {}

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
    return this.backend !== undefined;
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

  dispose(): void {
    for (const thread of this.threads) thread.pending?.abort();
  }

  async send(scope: AgentScope | null): Promise<void> {
    const thread = this.current;
    const prompt = thread.draft.trim();
    if (!prompt || thread.pending) return;
    // Say why nothing was sent rather than ignoring Enter.
    if (!this.backend || !scope) {
      thread.error = this.backend ? "Choose a sprint first: Sprint ▾" : "Agent is not set up: run board --agent-login";
      this.redraw();
      return;
    }
    const pending = new AbortController();
    const turn: Turn = { prompt, answer: "", choice: this.backend.current, started: Date.now() };
    thread.pending = pending;
    thread.draft = "";
    thread.error = "";
    thread.scroll = 0;
    const history = thread.turns.slice(-6);
    thread.turns.push(turn);
    try {
      const reply = this.backend.ask({
        scope,
        thread: thread.id,
        prompt,
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
      if (!pending.signal.aborted)
        thread.error = error instanceof Error ? clean(error.message) : "Agent request failed.";
    } finally {
      turn.finished = Date.now();
      const answered = turn.answer.trim() !== "";
      if (pending.signal.aborted && answered) turn.interrupted = true;
      else if (pending.signal.aborted || thread.error) {
        if (!answered) thread.turns.pop();
        thread.draft ||= prompt;
        if (pending.signal.aborted) thread.error = "Stopped.";
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
