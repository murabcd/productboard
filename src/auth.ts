/** Where the dashboard keeps its sign-in: settings in a file, the token in Keychain. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Credentials } from "./jira/http";

const KEYCHAIN_SERVICE = "productboard";
const CONFIG_PATH = join(homedir(), ".config", "productboard", "config.json");

const AGENT_PROVIDERS = ["openai", "anthropic"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

/** How long a model thinks before answering, as Eve names the levels. */
export const REASONING_LEVELS = ["none", "low", "medium", "high", "xhigh"] as const;
export type Reasoning = (typeof REASONING_LEVELS)[number];
/** Set explicitly, so the level shown is the level used: providers' own defaults vary by model. */
const DEFAULT_REASONING: Reasoning = "medium";

export interface ModelRef {
  provider: AgentProvider;
  model: string;
}

const AgentChoice = z.object({
  provider: z.enum(AGENT_PROVIDERS),
  model: z.string(),
  reasoning: z.enum(REASONING_LEVELS).default(DEFAULT_REASONING),
});
export type AgentChoice = z.infer<typeof AgentChoice>;

const Config = z.object({
  site: z.string(),
  email: z.string(),
  /** The board chosen last, opened again on the next start. */
  board: z.string().optional(),
  agent: AgentChoice.optional(),
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
  const token = readToken(KEYCHAIN_SERVICE, config.email);
  if (!token) return "Your API token is missing from Keychain. Run board --login.";
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
  saveToken(KEYCHAIN_SERVICE, email, `productboard (${site})`, token);
  // A board belongs to one site, so it is kept only when the site stays the same.
  // The Agent model belongs to the user, so it is always kept.
  const previous = readConfig();
  const board = previous?.site === site ? previous.board : undefined;
  writeConfig({ site, email, ...(board && { board }), ...(previous?.agent && { agent: previous.agent }) });
}

const AGENT_SERVICE = "productboard-agent";

export function agentProvider(): AgentProvider {
  return process.env.PRODUCTBOARD_AGENT_PROVIDER === "anthropic" ? "anthropic" : "openai";
}

const DEFAULT_MODELS: Record<AgentProvider, string> = { openai: "gpt-6-luna", anthropic: "claude-sonnet-5-5" };

/** The model Agent starts with: the environment's, else the one chosen last,
 * else the provider's default; and the reasoning chosen last, else medium. */
export function agentChoice(): AgentChoice {
  const saved = readConfig()?.agent;
  const provider = process.env.PRODUCTBOARD_AGENT_PROVIDER ? agentProvider() : (saved?.provider ?? "openai");
  const model =
    process.env.PRODUCTBOARD_AGENT_MODEL?.trim() ||
    (saved?.provider === provider ? saved.model : DEFAULT_MODELS[provider]);
  return { provider, model, reasoning: saved?.reasoning ?? DEFAULT_REASONING };
}

/** Keep the model chosen in Agent for the next start. */
export function rememberAgentChoice(agent: AgentChoice): void {
  const config = readConfig();
  if (config) writeConfig({ ...config, agent });
}

export function agentKeyName(provider: AgentProvider): "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}

export function loadAgentKey(provider: AgentProvider): string | undefined {
  return process.env[agentKeyName(provider)]?.trim() || readToken(AGENT_SERVICE, provider);
}

export function saveAgentKey(provider: AgentProvider, token: string): void {
  if (!TOKEN_PATTERN.test(token)) throw new Error("That doesn't look like a provider API key");
  saveToken(AGENT_SERVICE, provider, `Productboard Agent (${provider})`, token);
}

function readToken(service: string, account: string): string | undefined {
  const result = Bun.spawnSync(["security", "find-generic-password", "-s", service, "-a", account, "-w"]);
  return result.exitCode === 0 ? result.stdout.toString().trim() || undefined : undefined;
}

function saveToken(service: string, account: string, label: string, token: string): void {
  const command = `add-generic-password -U -s ${service} -a "${account}" -l "${label}" -w "${token}"\n`;
  const result = Bun.spawnSync(["security", "-i"], { stdin: Buffer.from(command) });
  if (result.exitCode !== 0 || readToken(service, account) !== token)
    throw new Error("Could not save the token to Keychain");
}
