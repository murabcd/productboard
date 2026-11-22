import { version } from "../package.json";
import { ChatArchive } from "./agent/archive";
import { EveAgent } from "./agent/eve";
import { loadCredentials, readConfig, rememberBoard, rememberTeamMode, rememberTheme } from "./auth";
import { desktop } from "./desktop";
import { JiraClient } from "./jira/client";
import { type Credentials, JiraHttp } from "./jira/http";
import { connectAgent, connectJira } from "./setup";
import { Workspace } from "./state/workspace";
import { clean } from "./text";
import { DEFAULT_THEME } from "./theme";
import { Dashboard } from "./ui/dashboard";
import { openScreen, type Screen } from "./ui/screen";

const USAGE = `Usage: productboard [--login | --agent-login | --check | --version | --help]

  productboard                Open the Inbox or start setup
  productboard --login        Connect or update your Jira account
  productboard --agent-login  Connect an Agent provider
  productboard --check        Check Jira access without opening the dashboard
  productboard --version      Print the Productboard version`;

const COMMANDS = ["--login", "--agent-login", "--check"] as const;
type LoginCommand = Exclude<(typeof COMMANDS)[number], "--check">;

async function main(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) return say(USAGE);
  if (args.includes("--version")) return say(`productboard v${version}`);
  const command = COMMANDS.find((flag) => args.includes(flag));
  if (args.length && !command) return fail(`Unknown option ${args[0]}\n\n${USAGE}`);
  if (command === "--check") {
    const saved = loadCredentials();
    return typeof saved === "string" ? fail(saved) : withJira(saved, check);
  }
  const saved = command ? undefined : loadCredentials();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (command) return fail(`Run productboard ${command} in a terminal.`);
    return fail(typeof saved === "string" ? saved : "Run productboard in a terminal, or use productboard --check.");
  }
  const screen = await openScreen(desktop.open);
  let result: number | string;
  try {
    result = await interactive(screen, command, typeof saved === "string" ? undefined : saved);
  } finally {
    await screen.close();
  }
  return typeof result === "string" ? say(result) : result;
}

async function interactive(
  screen: Screen,
  command: LoginCommand | undefined,
  saved?: Credentials,
): Promise<number | string> {
  if (command === "--agent-login") {
    const connected = await connectAgent(screen, readConfig()?.theme ?? DEFAULT_THEME);
    if (!connected) return 130;
    return connected === "chatgpt"
      ? "Connected to ChatGPT using your Codex sign-in."
      : "Agent API key saved to Keychain.";
  }
  const credentials = saved ?? (await connectJira(screen));
  if (!credentials) return 130;
  if (command === "--login") return `Connected to ${credentials.site}. Jira API token saved to Keychain.`;
  if (!saved) await connectAgent(screen, readConfig()?.theme ?? DEFAULT_THEME, "first-run");
  return withJira(credentials, (client) => dashboard(client, screen));
}

async function withJira(credentials: Credentials, use: (client: JiraClient) => Promise<number>): Promise<number> {
  const http = new JiraHttp(credentials);
  try {
    return await use(new JiraClient(http, readConfig()?.workflow));
  } finally {
    http.close();
  }
}

async function check(client: JiraClient): Promise<number> {
  const me = await client.myself();
  const { issues, more } = await client.recentIssues();
  return say(
    `Connected to ${client.site} as ${clean(me.displayName)} · ${issues.length} issues loaded${more ? " · more available" : ""}`,
  );
}

async function dashboard(client: JiraClient, screen: Screen): Promise<number> {
  const config = readConfig();
  const workspace = new Workspace(client, { preferredBoard: config?.board, rememberBoard });
  let storageError = "";
  const archive =
    config &&
    (await ChatArchive.open(ChatArchive.path(client.site, config.email)).catch(() => {
      storageError = "Could not open saved chats. Check local disk space and permissions.";
      return undefined;
    }));
  const board = new Dashboard(workspace, client, desktop, screen.redraw, {
    archive,
    agent: EveAgent.create(client),
    connectAgent: async (theme) => ((await connectAgent(screen, theme)) ? EveAgent.create(client) : undefined),
    teamMode: { initial: config?.teamMode, save: rememberTeamMode },
    appearance: { initial: config?.theme, save: rememberTheme },
  });
  if (storageError) board.agent.chat.storageError = storageError;
  // Scheduled refreshes and retries; the screen redraws only when state changes.
  const timer = setInterval(() => workspace.tick(), 1000);
  try {
    workspace.refresh();
    workspace.loadCatalog();
    await screen.show(board);
  } finally {
    clearInterval(timer);
    await board.dispose();
  }
  return 0;
}

function say(text: string): number {
  process.stdout.write(`${text}\n`);
  return 0;
}

function fail(text: string): number {
  process.stderr.write(`productboard: ${text}\n`);
  return 1;
}

process.exitCode = await main(process.argv.slice(2)).catch((error: unknown) =>
  fail(error instanceof Error ? error.message : String(error)),
);
process.exit();
