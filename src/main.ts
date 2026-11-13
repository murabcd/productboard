import { version } from "../package.json";
import { EveAgent } from "./agent/eve";
import { loadCredentials, readConfig, rememberBoard, rememberTheme } from "./auth";
import { JiraClient } from "./jira/client";
import { type Credentials, JiraHttp } from "./jira/http";
import { connectAgent, connectJira } from "./setup";
import { Workspace } from "./state/workspace";
import { clean } from "./text";
import { DEFAULT_THEME } from "./theme";
import { Dashboard, type Opener } from "./ui/dashboard";
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
  const screen = await openScreen((url) => run(["open", url]));
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
    return connected ? "Agent API key saved to Keychain." : 130;
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
    return await use(new JiraClient(http));
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
  const board = new Dashboard(workspace, client, macOpener, screen.redraw, {
    agent: EveAgent.create(client),
    connectAgent: async (theme) => ((await connectAgent(screen, theme)) ? EveAgent.create(client) : undefined),
    appearance: { initial: config?.theme, save: rememberTheme },
  });
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

const macOpener: Opener = {
  open: (url) => run(["open", "-a", "Helium", url]),
  copy: (text) => run(["pbcopy"], text),
};

async function run(command: string[], input?: string): Promise<void> {
  const child = Bun.spawn(command, {
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "ignore",
    stderr: "pipe",
    timeout: 5000,
  });
  if ((await child.exited) !== 0) {
    const error = clean((await new Response(child.stderr).text()).trim());
    throw new Error(error || "Could not open the link");
  }
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
