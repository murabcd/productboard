import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { type ClientConnection, client, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { type AgentChoice, agentChoice, agentKeyName, loadAgentKey, rememberAgentChoice } from "../auth";
import type { JiraClient } from "../jira/client";
import { initialQuery } from "../jira/query";
import type { AgentBackend } from "./chat";
import { type AgentModel, listModels, PROVIDER_NAMES } from "./models";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EVE = fileURLToPath(new URL("../../node_modules/eve/bin/eve.js", import.meta.url));
const REQUEST_TIMEOUT = 120_000;
const CONTEXT_LIMIT = 200;
type Ask = Parameters<AgentBackend["ask"]>[0];

interface EveProcess {
  child: ChildProcessWithoutNullStreams;
  connection: ClientConnection;
  ready: Promise<void>;
  sessions: Map<string, string>;
  responses: Map<string, Ask["onText"]>;
}

interface AgentSettings {
  read: typeof agentChoice;
  key: typeof loadAgentKey;
  remember: typeof rememberAgentChoice;
}

const localSettings: AgentSettings = { read: agentChoice, key: loadAgentKey, remember: rememberAgentChoice };

export class EveAgent implements AgentBackend {
  private active?: EveProcess;

  private constructor(
    private readonly jira: Pick<JiraClient, "snapshot">,
    private choice: AgentChoice,
    private apiKey: string,
    private readonly settings: AgentSettings,
  ) {}

  static create(jira: Pick<JiraClient, "snapshot">, settings = localSettings): EveAgent | undefined {
    const choice = settings.read();
    const key = settings.key(choice.provider);
    return key ? new EveAgent(jira, choice, key, settings) : undefined;
  }

  get current(): AgentChoice {
    return this.choice;
  }

  models(): Promise<AgentModel[]> {
    return listModels({ openai: this.settings.key("openai"), anthropic: this.settings.key("anthropic") });
  }

  /** Answer with another model or reasoning from now on, and on the next start.
   * The Eve process reads both at launch, so the next question starts a new one;
   * each question carries the recent conversation, so nothing is lost. */
  async use(choice: AgentChoice): Promise<void> {
    const key = this.settings.key(choice.provider);
    if (!key) throw new Error(`No ${PROVIDER_NAMES[choice.provider]} API key: run board --agent-login`);
    this.settings.remember(choice);
    const closing = this.close();
    this.choice = choice;
    this.apiKey = key;
    await closing;
  }

  async ask({ scope, thread, prompt, signal, history, onIssues, onText }: Ask): Promise<void> {
    const choice = this.choice;
    const { issues, more } = await this.jira.snapshot({ ...initialQuery, sprint: scope.sprint, limit: CONTEXT_LIMIT });
    signal.throwIfAborted();
    if (choice !== this.choice) throw new Error("Agent settings changed. Send the question again.");
    onIssues(issues);
    const process = this.connect();
    const { connection, sessions, responses } = process;
    await process.ready;
    signal.throwIfAborted();
    if (this.active !== process) throw new Error("Agent restarted. Send the question again.");
    const existing = sessions.get(thread);
    const sessionId =
      existing ??
      (
        await connection.agent.request(
          "session/new",
          { cwd: ROOT, mcpServers: [] },
          { cancellationSignal: AbortSignal.timeout(REQUEST_TIMEOUT), stopWaitingOnCancel: true },
        )
      ).sessionId;
    if (signal.aborted || this.active !== process) {
      if (!existing) void this.closeSession(connection, sessionId);
      signal.throwIfAborted();
      throw new Error("Agent restarted. Send the question again.");
    }
    sessions.set(thread, sessionId);
    const cancel = () => {
      if (sessions.get(thread) === sessionId) sessions.delete(thread);
      void connection.agent.notify("session/cancel", { sessionId }).catch(() => {});
    };
    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT);
    const cancellationSignal = AbortSignal.any([signal, deadline]);
    cancellationSignal.addEventListener("abort", cancel, { once: true });
    responses.set(sessionId, onText);
    try {
      const snapshot = JSON.stringify({
        sprint: scope.label,
        more,
        issues: issues.map(({ key, summary, status, category, assignee, priority }) => ({
          key,
          summary: summary.slice(0, 300),
          status,
          category,
          assignee,
          priority,
        })),
      });
      const prior =
        existing || history.length === 0
          ? ""
          : `Earlier conversation: ${JSON.stringify(
              history.map(({ prompt, answer }) => ({
                prompt,
                answer: answer.slice(0, 1500),
              })),
            )}\n\n`;
      const response = await connection.agent.request(
        "session/prompt",
        { sessionId, prompt: [{ type: "text", text: `${prior}Question: ${prompt}\n\nJira snapshot: ${snapshot}` }] },
        { cancellationSignal, stopWaitingOnCancel: true },
      );
      if (response.stopReason === "cancelled" && !signal.aborted) throw new Error("Agent stopped before replying.");
    } catch {
      if (cancellationSignal.aborted) void this.closeSession(connection, sessionId);
      throw new Error(
        deadline.aborted ? "Agent timed out. Try again." : "Agent could not reply. Check the provider key and model.",
      );
    } finally {
      responses.delete(sessionId);
      cancellationSignal.removeEventListener("abort", cancel);
    }
  }

  private connect(): EveProcess {
    if (this.active) return this.active;
    const child = spawn("node", [EVE, "acp"], {
      cwd: ROOT,
      stdio: "pipe",
      env: {
        ...process.env,
        [agentKeyName(this.choice.provider)]: this.apiKey,
        // The agent definition reads these, so the dashboard decides the model in one place.
        PRODUCTBOARD_AGENT_PROVIDER: this.choice.provider,
        PRODUCTBOARD_AGENT_MODEL: this.choice.model,
        PRODUCTBOARD_AGENT_REASONING: this.choice.reasoning,
        EVE_TELEMETRY_DISABLED: "1",
        EVE_TRACES: "off",
      },
    });
    const responses = new Map<string, Ask["onText"]>();
    child.stderr.resume();
    const connection = client()
      .onNotification("session/update", ({ params: { sessionId, update } }) => {
        if (this.active === run && update.sessionUpdate === "agent_message_chunk" && update.content.type === "text")
          responses.get(sessionId)?.(update.content.text);
      })
      .connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
    child.on("error", (error) => connection.close(error));
    void connection.closed.then(() => {
      if (this.active === run) void this.close();
    });
    const ready = connection.agent
      .request(
        "initialize",
        { protocolVersion: PROTOCOL_VERSION, clientInfo: { name: "productboard", version: "1.0.0" } },
        { cancellationSignal: AbortSignal.timeout(REQUEST_TIMEOUT), stopWaitingOnCancel: true },
      )
      .then(
        () => {},
        () => {
          if (this.active === run) void this.close();
          throw new Error("Could not start Eve. Install Node.js 24 and run bun install.");
        },
      );
    const run: EveProcess = { child, connection, ready, sessions: new Map(), responses };
    this.active = run;
    return run;
  }

  private async closeSession(connection: ClientConnection, sessionId: string): Promise<void> {
    await connection.agent
      .request(
        "session/close",
        { sessionId },
        {
          cancellationSignal: AbortSignal.timeout(1500),
          stopWaitingOnCancel: true,
        },
      )
      .catch(() => {});
  }

  async close(): Promise<void> {
    const run = this.active;
    if (!run) return;
    this.active = undefined;
    const { child, connection, sessions } = run;
    try {
      if (!connection.signal.aborted) {
        await Promise.all([...sessions.values()].map((id) => this.closeSession(connection, id)));
        connection.close();
      }
    } finally {
      child.kill();
    }
  }
}
