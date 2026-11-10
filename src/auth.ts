/** Where the dashboard keeps its sign-in: settings in a file, the token in Keychain. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Credentials } from "./jira/http";

const KEYCHAIN_SERVICE = "productboard";
const CONFIG_PATH = join(homedir(), ".config", "productboard", "config.json");

const Config = z.object({
  site: z.string(),
  email: z.string(),
  /** The board chosen last, opened again on the next start. */
  board: z.string().optional(),
});
type Config = z.infer<typeof Config>;

export const SITE_PATTERN = /^[a-z0-9-]+\.atlassian\.net$/;
// Keychain commands are sent as text, so values must not contain quotes.
const EMAIL_PATTERN = /^[^\s"\\]+@[^\s"\\]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_=+/.-]+$/;

export function readConfig(): Config | undefined {
  try {
    return Config.parse(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  } catch {
    return undefined;
  }
}

function writeConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function rememberBoard(board: string): void {
  const config = readConfig();
  if (config && config.board !== board) writeConfig({ ...config, board });
}

/** The saved sign-in, or a sentence telling the user how to create one. */
export function loadCredentials(): Credentials | string {
  const config = readConfig();
  if (!config) return "Sign in first: board --login";
  const read = Bun.spawnSync(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", config.email, "-w"]);
  const token = read.stdout.toString().trim();
  if (read.exitCode !== 0 || !token) return "Your API token is missing from Keychain. Run board --login.";
  return { site: config.site, email: config.email, token };
}

export function validate(credentials: Credentials): string | undefined {
  if (!SITE_PATTERN.test(credentials.site)) return "The site must look like your-team.atlassian.net";
  if (!EMAIL_PATTERN.test(credentials.email)) return "That doesn't look like an email address";
  if (!TOKEN_PATTERN.test(credentials.token)) return "That doesn't look like an Atlassian API token";
  return undefined;
}

/** Save settings, and the token to Keychain without putting it on a command line. */
export function saveCredentials(credentials: Credentials): void {
  const { site, email, token } = credentials;
  const command = `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a "${email}" -l "productboard (${site})" -w "${token}"\n`;
  const result = Bun.spawnSync(["security", "-i"], { stdin: Buffer.from(command) });
  const check = Bun.spawnSync(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", email]);
  if (result.exitCode !== 0 || check.exitCode !== 0) {
    throw new Error("Could not save the token to Keychain");
  }
  // A board belongs to one site, so it is kept only when the site stays the same.
  const previous = readConfig();
  const board = previous?.site === site ? previous.board : undefined;
  writeConfig(board ? { site, email, board } : { site, email });
}
