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
  exited: Promise<void>;
  sessions: Map<string, ClientSession>;
  close(): Promise<void>;
}

interface EveConfig {
  choice: AgentChoice;
  apiKey: string;
}

interface EveDependencies {
  read: typeof agentChoice;
  key: typeof loadAgentKey;
  remember: typeof rememberAgentChoice;
  start: typeof openEveProcess;
}

const localDependencies: EveDependencies = {
  read: agentChoice,
  key: loadAgentKey,
  remember: rememberAgentChoice,
  start: openEveProcess,
};

export class EveAgent implements AgentBackend {
  private active?: EveProcess;
  private closing?: Promise<void>;

  private constructor(
    private readonly jira: Pick<JiraClient, "search">,
    private config: EveConfig,
    private readonly deps: EveDependencies,
  ) {}

  static create(jira: Pick<JiraClient, "search">, deps = localDependencies): EveAgent | undefined {
    const choice = deps.read();
    const key = deps.key(choice.provider);
    return key ? new EveAgent(jira, { choice, apiKey: key }, deps) : undefined;
  }

  get current(): AgentChoice {
    return this.config.choice;
  }

  models(): Promise<AgentModel[]> {
    return listModels({ openai: this.deps.key("openai"), anthropic: this.deps.key("anthropic") });
  }

  /** Restart Eve with the saved model and reasoning for subsequent turns. */
  async use(choice: AgentChoice): Promise<void> {
    const key = this.deps.key(choice.provider);
    if (!key) throw new Error(`No ${PROVIDER_NAMES[choice.provider]} API key: run productboard --agent-login`);
    this.deps.remember(choice);
    this.config = { choice, apiKey: key };
    await this.close();
  }

  async ask({ thread, prompt, sprint, images, signal, history, onIssues, onText }: Ask): Promise<void> {
    const config = this.config;
    await this.closing;
    signal.throwIfAborted();
    if (this.config !== config) throw new Error("Agent restarted. Send the question again.");
    const run = this.connect(config);
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

  private connect(config: EveConfig): EveProcess {
    if (this.active) return this.active;
    const run = this.deps.start(this.jira, config);
    this.active = run;
    const retire = () => {
      if (this.active === run) void this.close();
    };
    void run.ready.catch(retire);
    void run.exited.then(retire);
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

function openEveProcess(jira: Pick<JiraClient, "search">, { choice, apiKey }: EveConfig): EveProcess {
  const search = openJiraSearch(jira);
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
        [agentKeyName(choice.provider)]: apiKey,
        PRODUCTBOARD_EVE_TOKEN: token,
        PRODUCTBOARD_AGENT_PROVIDER: choice.provider,
        PRODUCTBOARD_AGENT_MODEL: choice.model,
        PRODUCTBOARD_AGENT_REASONING: choice.reasoning,
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
    exited,
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
  });
  child.once("error", fail);
  deadline.addEventListener("abort", fail, { once: true });
  const clearDeadline = () => deadline.removeEventListener("abort", fail);
  void ready.then(clearDeadline, clearDeadline);
  return run;
}
