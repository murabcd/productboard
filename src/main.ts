/** jira: a read-only Jira workspace in the terminal. */

import { createInterface } from "node:readline/promises";
import { loadCredentials, readConfig, rememberBoard, saveCredentials, validate } from "./auth";
import { JiraClient } from "./jira/client";
import { type Credentials, JiraHttp } from "./jira/http";
import { initialQuery, View } from "./jira/query";
import { Workspace } from "./state/workspace";
import { clean } from "./text";
import { Dashboard, type Opener } from "./ui/dashboard";
import { openScreen } from "./ui/screen";

const USAGE = `Usage: jira [--login | --check | --help]

  jira           Open the dashboard
  jira --login   Save your Jira site, email and API token (token goes to Keychain)
  jira --check   Check Jira access without opening the dashboard`;

const TOKEN_PAGE = "https://id.atlassian.com/manage-profile/security/api-tokens";

async function main(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) return say(USAGE);
  if (args.includes("--login")) return login();
  const credentials = loadCredentials();
  if (typeof credentials === "string") return fail(credentials);
  const http = new JiraHttp(credentials);
  const client = new JiraClient(http);
  try {
    if (args.includes("--check")) return await check(client);
    if (args.length) return fail(`Unknown option ${args[0]}\n\n${USAGE}`);
    if (!process.stdin.isTTY || !process.stdout.isTTY) return fail("Run jira in a terminal, or use jira --check.");
    await dashboard(client, readConfig()?.board);
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    http.close();
  }
}

async function check(client: JiraClient): Promise<number> {
  const me = await client.myself();
  const snapshot = await client.snapshot({ ...initialQuery, view: View.All });
  const more = snapshot.more ? " · more available" : "";
  return say(
    `Connected to ${client.site} as ${clean(me.displayName)} · ${snapshot.issues.length} issues loaded${more}`,
  );
}

async function dashboard(client: JiraClient, preferredBoard: string | undefined): Promise<void> {
  const screen = await openScreen();
  const workspace = new Workspace(client, { preferredBoard, rememberBoard });
  // Scheduled refreshes and retries; the screen redraws only when state changes.
  const timer = setInterval(() => workspace.tick(), 1000);
  try {
    const board = new Dashboard(workspace, client, macOpener, screen.redraw);
    workspace.loadCatalog();
    await screen.show(board);
  } finally {
    clearInterval(timer);
    await screen.close();
  }
}

/** Open links in Helium and copy with pbcopy. */
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

async function login(): Promise<number> {
  if (!process.stdin.isTTY) return fail("Run jira --login in a terminal.");
  const previous = readConfig();
  say("Sign in to Jira with an API token. The token is saved to your macOS Keychain.");
  const site = (await ask("Jira site", previous?.site)).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const email = await ask("Email", previous?.email);
  say(`Create a token at ${TOKEN_PAGE}`);
  const token = await askHidden("API token");
  const credentials: Credentials = { site: site.toLowerCase(), email, token };
  const problem = validate(credentials);
  if (problem) return fail(problem);
  const http = new JiraHttp(credentials);
  try {
    const me = await new JiraClient(http).myself();
    saveCredentials(credentials);
    return say(`Signed in as ${clean(me.displayName)} on ${credentials.site}. Token saved to Keychain.`);
  } catch (error) {
    return fail(`Jira did not accept these details: ${error instanceof Error ? error.message : error}`);
  } finally {
    http.close();
  }
}

async function ask(question: string, fallback = ""): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim();
    return answer || fallback;
  } finally {
    prompt.close();
  }
}

/** Read a line without echoing it. */
function askHidden(question: string): Promise<string> {
  process.stdout.write(`${question} (hidden): `);
  return new Promise((resolve, reject) => {
    let value = "";
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    const done = (finish: () => void) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      finish();
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") return done(() => resolve(value.trim()));
        if (char === "\u0003") return done(() => reject(new Error("Cancelled")));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    stdin.on("data", onData);
  });
}

function say(text: string): number {
  process.stdout.write(`${text}\n`);
  return 0;
}

function fail(text: string): number {
  process.stderr.write(`jira: ${text}\n`);
  return 1;
}

process.exitCode = await main(process.argv.slice(2));
process.exit();
