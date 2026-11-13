/** Where the dashboard keeps its sign-in: settings in a file, the token in Keychain. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Credentials } from "./jira/http";
import { THEME_IDS, type ThemeId } from "./theme";

const KEYCHAIN_SERVICE = "productboard";
const CONFIG_PATH = join(homedir(), ".config", "productboard", "config.json");
export const SITE_PATTERN = /^[a-z0-9-]+\.atlassian\.net$/;

export const API_KEY_PROVIDERS = ["openai", "anthropic"] as const;
export type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];
export const AGENT_PROVIDERS = [...API_KEY_PROVIDERS, "chatgpt"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

/** How long a model thinks before answering, as Eve names the levels. */
export const REASONING_LEVELS = ["none", "low", "medium", "high", "xhigh"] as const;
export type Reasoning = (typeof REASONING_LEVELS)[number];
/** Set explicitly, so the level shown is the level used: providers' own defaults vary by model. */
const DEFAULT_REASONING: Reasoning = "medium";
const RECENT_MODEL_LIMIT = 5;

const ModelRef = z.object({
  provider: z.enum(AGENT_PROVIDERS),
  model: z.string(),
});
export type ModelRef = z.infer<typeof ModelRef>;

const AgentChoice = ModelRef.extend({
  reasoning: z.enum(REASONING_LEVELS).default(DEFAULT_REASONING),
});
export type AgentChoice = z.infer<typeof AgentChoice>;
export type AgentChoiceChange = "model" | "reasoning";

const Config = z.object({
  site: z.string().regex(SITE_PATTERN),
  email: z.string(),
  /** The board chosen last, opened again on the next start. */
  board: z.string().optional(),
  agent: AgentChoice.optional(),
  chatgptConnected: z.boolean().optional(),
  recentAgentModels: z.array(ModelRef).optional().catch(undefined),
  theme: z.enum(THEME_IDS).optional().catch(undefined),
});
type Config = z.infer<typeof Config>;

// Keychain commands are sent as text, so values must not contain quotes.
const EMAIL_PATTERN = /^[^\s"\\]+@[^\s"\\]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_=+/.-]+$/;
const JIRA_FIELDS = {
  site: [SITE_PATTERN, "Enter a site like your-team.atlassian.net."],
  email: [EMAIL_PATTERN, "Enter your Atlassian account email."],
  token: [TOKEN_PATTERN, "Paste your Atlassian API token."],
} as const;

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

export function rememberTheme(theme: ThemeId): void {
  const config = readConfig();
  if (!config) throw new Error("Preferences are unavailable");
  if (config.theme !== theme) writeConfig({ ...config, theme });
}

/** The saved sign-in, or a sentence telling the user how to create one. */
export function loadCredentials(): Credentials | string {
  const config = readConfig();
  if (!config) return "Sign in first: productboard --login";
  const token = readToken(KEYCHAIN_SERVICE, config.email);
  if (!token) return "Your API token is missing from Keychain. Run productboard --login.";
  return { site: config.site, email: config.email, token };
}

export function validateJiraField(field: keyof Credentials, value: string): void {
  const [pattern, error] = JIRA_FIELDS[field];
  if (!pattern.test(value)) throw new Error(error);
}

/** Save settings, and the token to Keychain without putting it on a command line. */
export function saveCredentials(credentials: Credentials): void {
  const { site, email, token } = credentials;
  saveToken(KEYCHAIN_SERVICE, email, `productboard (${site})`, token);
  // A board belongs to one site, so it is kept only when the site stays the same.
  const previous = readConfig();
  const board = previous?.site === site ? previous.board : undefined;
  writeConfig({ ...previous, site, email, board });
}

const AGENT_SERVICE = "productboard-agent";

export function agentProviderOverride(): AgentProvider | undefined {
  const provider = process.env.PRODUCTBOARD_AGENT_PROVIDER;
  if (provider) return AGENT_PROVIDERS.find((candidate) => candidate === provider) ?? "openai";
}

const DEFAULT_MODELS: Record<AgentProvider, string> = {
  openai: "gpt-6-luna",
  anthropic: "claude-sonnet-5-5",
  chatgpt: "gpt-6-luna-fast",
};

/** The model Agent starts with: the environment's, else the one chosen last,
 * else the provider's default; and the reasoning chosen last, else medium. */
export function agentChoice(): AgentChoice {
  const saved = readConfig()?.agent;
  const choice = choiceForProvider(agentProviderOverride() ?? saved?.provider ?? "openai", saved);
  return { ...choice, model: process.env.PRODUCTBOARD_AGENT_MODEL?.trim() || choice.model };
}

function choiceForProvider(provider: AgentProvider, saved?: AgentChoice): AgentChoice {
  return {
    provider,
    model: saved?.provider === provider ? saved.model : DEFAULT_MODELS[provider],
    reasoning: saved?.reasoning ?? DEFAULT_REASONING,
  };
}

function rememberAgentProvider(provider: AgentProvider): void {
  const config = readConfig();
  if (config && config.agent?.provider !== provider) {
    writeConfig({ ...config, agent: choiceForProvider(provider, config.agent) });
  }
}

export function recentAgentModels(): readonly ModelRef[] {
  return readConfig()?.recentAgentModels?.slice(0, RECENT_MODEL_LIMIT) ?? [];
}

export function chatgptConnected(): boolean {
  return agentProviderOverride() === "chatgpt" || readConfig()?.chatgptConnected === true;
}

export function rememberChatGPT(model: string): void {
  const config = readConfig();
  if (!config) throw new Error("Connect Jira first with productboard --login.");
  const choice = choiceForProvider("chatgpt", config.agent);
  writeConfig({
    ...config,
    agent: config.agent?.provider === "chatgpt" ? choice : { ...choice, model },
    chatgptConnected: true,
  });
}

export function promoteRecentModel({ provider, model }: ModelRef, recent: readonly ModelRef[]): ModelRef[] {
  return [{ provider, model }, ...recent.filter((entry) => entry.provider !== provider || entry.model !== model)].slice(
    0,
    RECENT_MODEL_LIMIT,
  );
}

/** Save the active choice and record explicit model picks in the same settings write. */
export function rememberAgentChoice(agent: AgentChoice, change: AgentChoiceChange): readonly ModelRef[] {
  const config = readConfig();
  if (!config) return [];
  const recent = config.recentAgentModels ?? [];
  const updated = change === "model" ? promoteRecentModel(agent, recent) : recent.slice(0, RECENT_MODEL_LIMIT);
  writeConfig({ ...config, agent, recentAgentModels: updated });
  return updated;
}

export function agentKeyName(provider: ApiKeyProvider): "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}

export function loadAgentKey(provider: ApiKeyProvider): string | undefined {
  return process.env[agentKeyName(provider)]?.trim() || readToken(AGENT_SERVICE, provider);
}

/** On first run, reuse the selected connection or adopt another saved key if the provider is unpinned. */
export function reuseAgentConnection(): boolean {
  const { provider } = agentChoice();
  if (provider === "chatgpt") return readConfig()?.chatgptConnected === true;
  if (loadAgentKey(provider)) return true;
  if (agentProviderOverride()) return false;
  const alternate = API_KEY_PROVIDERS.find((candidate) => candidate !== provider && loadAgentKey(candidate));
  if (!alternate) return false;
  rememberAgentProvider(alternate);
  return true;
}

export function saveAgentKey(provider: ApiKeyProvider, token: string): void {
  if (!TOKEN_PATTERN.test(token)) throw new Error("That doesn't look like a provider API key");
  saveToken(AGENT_SERVICE, provider, `Productboard Agent (${provider})`, token);
  rememberAgentProvider(provider);
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
