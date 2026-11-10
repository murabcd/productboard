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

export class EveAgent implements AgentBackend {
  private process?: ChildProcessWithoutNullStreams;
  private ready?: Promise<ClientConnection>;
  private connection?: ClientConnection;
  private readonly sessions = new Map<string, string>();

  private constructor(
    private readonly jira: Pick<JiraClient, "snapshot">,
    private choice: AgentChoice,
    private apiKey: string,
  ) {}

  static create(jira: Pick<JiraClient, "snapshot">): EveAgent | undefined {
    const choice = agentChoice();
    const key = loadAgentKey(choice.provider);
    return key ? new EveAgent(jira, choice, key) : undefined;
  }

  get current(): AgentChoice {
    return this.choice;
  }

  models(): Promise<AgentModel[]> {
    return listModels({ openai: loadAgentKey("openai"), anthropic: loadAgentKey("anthropic") });
  }

  /** Answer with another model or reasoning from now on, and on the next start.
   * The Eve process reads both at launch, so the next question starts a new one;
   * each question carries the recent conversation, so nothing is lost. */
  async use(choice: AgentChoice): Promise<void> {
    const key = loadAgentKey(choice.provider);
    if (!key) throw new Error(`No ${PROVIDER_NAMES[choice.provider]} API key: run board --agent-login`);
    await this.close();
    this.choice = choice;
    this.apiKey = key;
    rememberAgentChoice(choice);
  }

  async ask({ scope, thread, prompt, signal, history, onIssues, onText }: Ask): Promise<void> {
    const { issues, more } = await this.jira.snapshot({ ...initialQuery, sprint: scope.sprint, limit: CONTEXT_LIMIT });
    signal.throwIfAborted();
    onIssues(issues);
    const connection = await this.connect();
    signal.throwIfAborted();
    const existing = this.sessions.get(thread);
    const sessionId =
      existing ??
      (
        await connection.agent.request(
          "session/new",
          { cwd: ROOT, mcpServers: [] },
          { cancellationSignal: AbortSignal.timeout(REQUEST_TIMEOUT), stopWaitingOnCancel: true },
        )
      ).sessionId;
    signal.throwIfAborted();
    this.sessions.set(thread, sessionId);
    const cancel = () => {
      if (this.sessions.get(thread) === sessionId) this.sessions.delete(thread);
      void connection.agent.notify("session/cancel", { sessionId }).catch(() => {});
    };
    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT);
    const cancellationSignal = AbortSignal.any([signal, deadline]);
    signal.addEventListener("abort", cancel, { once: true });
    deadline.addEventListener("abort", cancel, { once: true });
    this.responses.set(sessionId, onText);
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
      this.responses.delete(sessionId);
      signal.removeEventListener("abort", cancel);
      deadline.removeEventListener("abort", cancel);
    }
  }

  private readonly responses = new Map<string, Ask["onText"]>();

  private connect(): Promise<ClientConnection> {
    if (this.ready) return this.ready;
    const ready = this.launch().catch(async () => {
      if (this.ready === ready) await this.close();
      throw new Error("Could not start Eve. Install Node.js 24 and run bun install.");
    });
    this.ready = ready;
    return ready;
  }

  private async launch(): Promise<ClientConnection> {
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
    this.process = child;
    // ACP reserves stdout for protocol messages. Drain diagnostics without writing over the terminal UI.
    child.stderr.resume();
    const connection = client()
      .onNotification("session/update", ({ params: { sessionId, update } }) => {
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text")
          this.responses.get(sessionId)?.(update.content.text);
      })
      .connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
    this.connection = connection;
    child.on("error", (error) => connection.close(error));
    void connection.closed.then(() => {
      if (this.process === child) void this.close();
    });
    await connection.agent.request(
      "initialize",
      { protocolVersion: PROTOCOL_VERSION, clientInfo: { name: "productboard", version: "1.0.0" } },
      { cancellationSignal: AbortSignal.timeout(REQUEST_TIMEOUT), stopWaitingOnCancel: true },
    );
    return connection;
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
    const child = this.process;
    const connection = this.connection;
    const sessions = [...this.sessions.values()];
    this.process = undefined;
    this.connection = undefined;
    this.ready = undefined;
    this.sessions.clear();
    this.responses.clear();
    if (connection && !connection.signal.aborted) {
      await Promise.all(sessions.map((id) => this.closeSession(connection, id)));
      connection.close();
    }
    child?.kill();
  }
}
