import type { AgentChoice } from "../auth";
import type { Issue, Sprint } from "../jira/types";
import { clean } from "../text";
import { type Draft, type DraftImage, draftImages, draftText, expandDraft } from "./draft";
import { type AgentImage, MAX_IMAGES, MAX_MESSAGE_IMAGE_BYTES, readAgentImage } from "./images";
import type { AgentModel } from "./models";

type SprintContext = Pick<Sprint, "id" | "name">;

export interface AgentBackend {
  /** The model and reasoning that answer, shown under each reply. */
  readonly current: AgentChoice;
  models(): Promise<AgentModel[]>;
  /** Answer with another model or reasoning from now on. */
  use(choice: AgentChoice): Promise<void>;
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
  prompt: string;
  sprint?: SprintContext;
  displayPrompt: string;
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
  draft: Draft;
  sprint?: SprintContext;
  error: string;
  scroll: number;
}

const conversation = (): Conversation => ({
  id: crypto.randomUUID(),
  turns: [],
  issues: new Map(),
  draft: [],
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

  async attachImage(path: string, label: string, insert: (attachment: DraftImage) => void): Promise<void> {
    const thread = this.current;
    if (draftImages(thread.draft).length >= MAX_IMAGES) {
      thread.error = `Attach up to ${MAX_IMAGES} images per message.`;
      this.redraw();
      return;
    }
    const attachment: DraftImage = { kind: "image", label, state: { kind: "loading" } };
    thread.error = "";
    insert(attachment);
    try {
      const image = await readAgentImage(path);
      if (imageSize(draftImages(thread.draft)) + image.bytes.byteLength > MAX_MESSAGE_IMAGE_BYTES) {
        throw new Error("Images can be up to 6 MB per message.");
      }
      attachment.state = { kind: "ready", image };
    } catch (error) {
      attachment.state = { kind: "failed" };
      if (thread.draft.includes(attachment)) thread.draft = thread.draft.filter((part) => part !== attachment);
      thread.error = error instanceof Error && !("code" in error) ? clean(error.message) : "Could not read the image.";
    } finally {
      this.redraw();
    }
  }

  async send(): Promise<void> {
    const thread = this.current;
    if (thread.pending) return;
    const { draft } = thread;
    const attachments = draftImages(draft);
    if (attachments.some(({ state }) => state.kind === "loading")) return;
    if (attachments.some(({ state }) => state.kind === "failed")) {
      thread.error = "Remove the image that could not be attached before sending.";
      this.redraw();
      return;
    }
    if (attachments.length > MAX_IMAGES || imageSize(attachments) > MAX_MESSAGE_IMAGE_BYTES) {
      thread.error = `Attach up to ${MAX_IMAGES} images and 6 MB per message.`;
      this.redraw();
      return;
    }
    const images = attachments.flatMap(({ state }) => (state.kind === "ready" ? [state.image] : []));
    const prompt = expandDraft(draft);
    if (!prompt.trim() && !images.length) return;
    // Say why nothing was sent rather than ignoring Enter.
    if (!this.backend) {
      thread.error = "Agent is not set up: run board --agent-login";
      this.redraw();
      return;
    }
    const pending = new AbortController();
    const turn: Turn = {
      prompt,
      sprint: thread.sprint,
      displayPrompt: draftText(draft).trim(),
      answer: "",
      choice: this.backend.current,
      started: Date.now(),
    };
    thread.pending = pending;
    thread.draft = [];
    thread.sprint = undefined;
    thread.error = "";
    thread.scroll = 0;
    const history = thread.turns.slice(-6);
    thread.turns.push(turn);
    let failure = "";
    try {
      const reply = this.backend.ask({
        thread: thread.id,
        prompt,
        sprint: turn.sprint,
        images,
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
        if (thread.draft.length === 0) thread.draft = draft;
        thread.sprint ??= turn.sprint;
        thread.error = pending.signal.aborted ? "Stopped." : failure;
      }
      thread.pending = undefined;
      this.redraw();
    }
  }
}

function imageSize(images: readonly DraftImage[]): number {
  return images.reduce((bytes, { state }) => bytes + (state.kind === "ready" ? state.image.bytes.byteLength : 0), 0);
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
