/** Agent's place on screen: its page and conversation history.
 * The dashboard routes input here. */

import { type AgentBackend, AgentChat } from "../agent/chat";
import type { AgentModel } from "../agent/models";
import type { AgentChoice, AgentChoiceChange, ModelRef, Reasoning } from "../auth";
import { message } from "../state/workspace";
import { type Key, keyId } from "./input";
import type { AgentLayout } from "./layout";
import { transcriptWindow } from "./transcript";

const WHEEL_LINES = 3;

export class AgentPanel {
  tab = false;
  /** Rows of text in the text box, so the frame leaves room for it. */
  composerRows = 1;
  /** Models to switch to, listed when the model picker opens. */
  models: AgentModel[] = [];
  modelsPending = false;
  modelsError = "";
  readonly chat: AgentChat;

  constructor(
    backend: AgentBackend | undefined,
    /** Schedules a new frame after a reply streams in. */
    redraw: () => void,
    /** Refreshes open pickers when their data changes. */
    private readonly changed: () => void,
  ) {
    this.chat = new AgentChat(backend, redraw);
  }

  get current(): AgentChoice | undefined {
    return this.chat.backend?.current;
  }

  get recentModels(): readonly ModelRef[] {
    return this.chat.backend?.recentModels ?? [];
  }

  loadModels(): void {
    const backend = this.chat.backend;
    if (!backend || this.modelsPending) return;
    this.modelsPending = true;
    this.modelsError = "";
    backend
      .models()
      .then(
        (models) => {
          this.models = models;
        },
        (error: unknown) => {
          this.modelsError = message(error);
        },
      )
      .finally(() => {
        this.modelsPending = false;
        this.changed();
      });
  }

  useModel({ provider, model }: ModelRef): void {
    const current = this.current;
    if (current) this.use({ provider, model, reasoning: current.reasoning }, "model");
  }

  useReasoning(reasoning: Reasoning): void {
    const current = this.current;
    if (current) this.use({ ...current, reasoning }, "reasoning");
  }

  /** Answer with `choice` from the next question on; a failure shows under the box. */
  private use(choice: AgentChoice, change: AgentChoiceChange): void {
    const backend = this.chat.backend;
    if (!backend) return;
    const thread = this.chat.current;
    backend.use(choice, change).then(
      () => this.changed(),
      (error: unknown) => {
        thread.draft.error = message(error);
        this.changed();
      },
    );
  }

  send(): void {
    void this.chat.send();
  }

  /** Keys while Agent is active. Typing goes to the text box; these are the rest. */
  key(key: Key, { transcript }: AgentLayout): void {
    const thread = this.chat.current;
    switch (keyId(key)) {
      case "escape":
      case "ctrl-c":
        // Esc interrupts an active reply before leaving Agent.
        if (thread.pending) this.chat.stop();
        else this.tab = false;
        return;
      case "agent-new":
        this.chat.start();
        return;
      case "agent-stop":
        this.chat.stop();
        return;
      case "agent-previous":
      case "agent-next":
        this.chat.select(keyId(key) === "agent-previous" ? -1 : 1);
        return;
      case "pageup":
      case "pagedown":
        this.scroll(transcript, keyId(key) === "pageup" ? transcript.capacity : -transcript.capacity);
        return;
    }
  }

  wheel(delta: number, { transcript }: AgentLayout): void {
    this.scroll(transcript, -delta * WHEEL_LINES);
  }

  private scroll(transcript: AgentLayout["transcript"], delta: number): void {
    const thread = this.chat.current;
    thread.scroll = transcriptWindow(thread.turns, transcript, thread.scroll, delta).scroll;
  }
}
