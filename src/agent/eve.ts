import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Client, type ClientSession, createDataUrlFilePart, isTurnFailureEvent } from "eve/client";
import { JiraSearchResult } from "../../agent/lib/jira-search";
import { type AgentChoice, agentChoice, agentKeyName, loadAgentKey, rememberAgentChoice } from "../auth";
import type { JiraClient } from "../jira/client";
import type { AgentBackend } from "./chat";
import { openJiraSearch } from "./jira-search";
import { type AgentModel, listModels, PROVIDER_NAMES } from "./models";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EVE = fileURLToPath(new URL("../../node_modules/eve/bin/eve.js", import.meta.url));
const REQUEST_TIMEOUT = 120_000;
const LISTENING = /\[DEV\] server listening at (http:\/\/127\.0\.0\.1:\d+\/)/;
type Ask = Parameters<AgentBackend["ask"]>[0];

interface EveProcess {
  ready: Promise<Client>;
  sessions: Map<string, ClientSession>;
  close(): Promise<void>;
}

interface AgentSettings {
  read: typeof agentChoice;
  key: typeof loadAgentKey;
  remember: typeof rememberAgentChoice;
}

const localSettings: AgentSettings = { read: agentChoice, key: loadAgentKey, remember: rememberAgentChoice };

export class EveAgent implements AgentBackend {
  private active?: EveProcess;
  private closing?: Promise<void>;

  private constructor(
    private readonly jira: Pick<JiraClient, "search">,
    private choice: AgentChoice,
    private apiKey: string,
    private readonly settings: AgentSettings,
  ) {}

  static create(jira: Pick<JiraClient, "search">, settings = localSettings): EveAgent | undefined {
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

  /** Restart Eve with the saved model and reasoning for subsequent turns. */
  async use(choice: AgentChoice): Promise<void> {
    const key = this.settings.key(choice.provider);
    if (!key) throw new Error(`No ${PROVIDER_NAMES[choice.provider]} API key: run board --agent-login`);
    this.settings.remember(choice);
    const closing = this.close();
    this.choice = choice;
    this.apiKey = key;
    await closing;
  }

  async ask({ thread, prompt, sprint, images, signal, history, onIssues, onText }: Ask): Promise<void> {
    await this.closing;
    signal.throwIfAborted();
    const run = this.connect();
    const client = await run.ready;
    signal.throwIfAborted();
    if (this.active !== run) throw new Error("Agent restarted. Send the question again.");

    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT);
    const stop = AbortSignal.any([signal, deadline]);
    const existing = run.sessions.get(thread);
    let session = existing;
    const evict = () => {
      if (run.sessions.get(thread) === session) run.sessions.delete(thread);
    };
    try {
      session ??= (await client.sessions.create({ signal: stop })).session;
      stop.throwIfAborted();
      if (this.active !== run) throw new Error("Agent restarted. Send the question again.");
      run.sessions.set(thread, session);
      stop.addEventListener("abort", evict, { once: true });
      const prior =
        existing || history.length === 0
          ? ""
          : `Earlier conversation: ${JSON.stringify(
              history.map(({ prompt, answer }) => ({ prompt, answer: answer.slice(0, 1500) })),
            )}\n\n`;
      const text = `${prior}${prompt || "Describe the attached images."}`;
      const message = images.length ? [{ type: "text" as const, text }, ...images.map(createDataUrlFilePart)] : text;
      const response = await session.send(message, {
        signal: stop,
        clientContext: sprint
          ? `The user attached Jira sprint ${JSON.stringify(sprint.name)} (ID ${sprint.id}). For Jira searches about this sprint, use JQL sprint = ${sprint.id}.`
          : undefined,
      });
      for await (const event of response) {
        if (event.type === "message.appended") onText(event.data.messageDelta);
        if (event.type === "action.result" && event.data.result.kind === "tool-result") {
          const result = JiraSearchResult.safeParse(event.data.result.output);
          if (result.success) onIssues(result.data.issues);
        }
        if (isTurnFailureEvent(event)) throw new Error(event.data.message);
      }
      stop.throwIfAborted();
    } catch (error) {
      if (session) {
        evict();
        void session.reset({ signal: AbortSignal.timeout(1500) }).catch(() => {});
      }
      throw new Error(
        deadline.aborted ? "Agent timed out. Try again." : "Agent could not reply. Check the provider key and model.",
        { cause: error },
      );
    } finally {
      stop.removeEventListener("abort", evict);
    }
  }

  private connect(): EveProcess {
    if (this.active) return this.active;
    const search = openJiraSearch(this.jira);
    const token = randomBytes(32).toString("hex");
    const child = spawn(
      "node",
      [EVE, "dev", "--host", "127.0.0.1", "--port", "0", "--no-ui", "--no-default-extensions"],
      {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...search.env,
          [agentKeyName(this.choice.provider)]: this.apiKey,
          PRODUCTBOARD_EVE_TOKEN: token,
          PRODUCTBOARD_AGENT_PROVIDER: this.choice.provider,
          PRODUCTBOARD_AGENT_MODEL: this.choice.model,
          PRODUCTBOARD_AGENT_REASONING: this.choice.reasoning,
          EVE_TELEMETRY_DISABLED: "1",
          EVE_TRACES: "off",
        },
      },
    );
    const { promise: ready, resolve, reject } = Promise.withResolvers<Client>();
    const { promise: exited, resolve: exit } = Promise.withResolvers<void>();
    const sessions = new Map<string, ClientSession>();
    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT);
    const fail = () => reject(new Error("Could not start Eve. Install Node.js 24 and run bun install."));
    const run: EveProcess = {
      ready,
      sessions,
      close: async () => {
        if (child.exitCode === null && child.signalCode === null) {
          const signal = AbortSignal.timeout(1500);
          await Promise.allSettled([...sessions.values()].map((session) => session.reset({ signal })));
        }
        child.kill();
        await Promise.all([search.close(), exited]);
      },
    };
    const onLine = (line: string) => {
      const host = LISTENING.exec(line)?.[1];
      if (host) resolve(new Client({ host, headers: { Authorization: `Bearer ${token}` }, redirect: "error" }));
    };
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on("line", onLine);
    child.once("close", () => {
      fail();
      exit();
      if (this.active === run) void this.close();
    });
    child.once("error", fail);
    deadline.addEventListener("abort", fail, { once: true });
    void ready
      .catch(() => {
        if (this.active === run) void this.close();
      })
      .finally(() => deadline.removeEventListener("abort", fail));
    this.active = run;
    return run;
  }

  async close(): Promise<void> {
    const run = this.active;
    if (run) {
      this.active = undefined;
      this.closing = run.close();
    }
    const closing = this.closing;
    await closing;
    if (this.closing === closing) this.closing = undefined;
  }
}
