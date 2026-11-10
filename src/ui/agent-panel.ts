/** Agent's place on screen: its page and conversation history.
 * The dashboard routes input here. */

import { type AgentBackend, AgentChat } from "../agent/chat";
import type { AgentModel } from "../agent/models";
import type { AgentChoice, ModelRef, Reasoning } from "../auth";
import { message } from "../state/workspace";
import { type Key, keyId } from "./input";

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
    private readonly backend: AgentBackend | undefined,
    /** Schedules a new frame after a reply streams in. */
    redraw: () => void,
    /** Runs when the model list or the model changes, so open pickers refresh. */
    private readonly changed: () => void,
  ) {
    this.chat = new AgentChat(backend, redraw);
  }

  get current(): AgentChoice | undefined {
    return this.backend?.current;
  }

  loadModels(): void {
    if (!this.backend || this.modelsPending) return;
    this.modelsPending = true;
    this.modelsError = "";
    this.backend
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
    if (current) this.use({ provider, model, reasoning: current.reasoning });
  }

  useReasoning(reasoning: Reasoning): void {
    const current = this.current;
    if (current) this.use({ ...current, reasoning });
  }

  /** Answer with `choice` from the next question on; a failure shows under the box. */
  private use(choice: AgentChoice): void {
    if (!this.backend) return;
    const thread = this.chat.current;
    this.backend.use(choice).then(
      () => this.changed(),
      (error: unknown) => {
        thread.error = message(error);
        this.changed();
      },
    );
  }

  send(): void {
    void this.chat.send();
  }

  /** Keys while Agent is active. Typing goes to the text box; these are the rest. */
  key(key: Key, page: number): void {
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
        thread.scroll = Math.max(0, thread.scroll + (keyId(key) === "pageup" ? page : -page));
        return;
    }
  }

  wheel(delta: number): void {
    const thread = this.chat.current;
    thread.scroll = Math.max(0, thread.scroll - delta * WHEEL_LINES);
  }

  dispose(): void {
    this.chat.dispose();
  }
}
