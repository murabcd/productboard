import { z } from "zod";
import type { AgentChoice, AgentProvider, ModelRef, Reasoning } from "../auth";
import { clean } from "../text";

export interface AgentModel extends ModelRef {
  /** When the provider released it, in milliseconds; the list is newest first. */
  created: number;
}

export const REASONING_NAMES: Record<Reasoning, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};

/** A choice as it reads everywhere it shows: "GPT-6 Luna · medium". */
export const choiceLabel = ({ model, reasoning }: AgentChoice): string =>
  `${modelName(model)} · ${REASONING_NAMES[reasoning]}`;

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** How a model reads everywhere: "gpt-6.1-sol" is "GPT-6.1 Sol" and
 * "claude-sonnet-5-5" is "Claude Sonnet 5.5". A trailing date is left out. */
export function modelName(id: string): string {
  const words = id.split("-").filter((word) => !/^\d{8}$/.test(word));
  if (words[0] === "gpt") return [`GPT-${words[1] ?? ""}`, ...words.slice(2).map(capitalize)].join(" ");
  const version = words.filter((word) => /^\d+$/.test(word)).join(".");
  const name = words.filter((word) => !/^\d+$/.test(word)).map(capitalize);
  return [...name, version].filter(Boolean).join(" ");
}

export const PROVIDER_NAMES: Record<AgentProvider, string> = { openai: "OpenAI", anthropic: "Anthropic" };

const OpenAIModels = z.object({ data: z.array(z.object({ id: z.string(), created: z.number() })) });
const AnthropicModels = z.object({ data: z.array(z.object({ id: z.string(), created_at: z.string() })) });

const GENERATIONS: Record<AgentProvider, RegExp> = {
  openai: /^gpt-6(\.\d+)?(-|$)/,
  anthropic: /^claude-[a-z]+-5([-.]|$)/,
};
/** OpenAI lists every model, including ones that don't chat. */
const NOT_CHAT = /audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct/;

const TIMEOUT_MS = 15_000;

async function request(fetcher: typeof fetch, url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetcher(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`could not list models (HTTP ${response.status})`);
  return response.json();
}

async function providerModels(provider: AgentProvider, key: string, fetcher: typeof fetch): Promise<AgentModel[]> {
  if (provider === "openai") {
    const { data } = OpenAIModels.parse(
      await request(fetcher, "https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` }),
    );
    return data
      .filter(({ id }) => GENERATIONS.openai.test(id) && !NOT_CHAT.test(id))
      .map(({ id, created }) => ({ provider, model: clean(id), created: created * 1000 }));
  }
  const { data } = AnthropicModels.parse(
    await request(fetcher, "https://api.anthropic.com/v1/models?limit=100", {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
  );
  return data
    .filter(({ id }) => GENERATIONS.anthropic.test(id))
    .map(({ id, created_at }) => ({ provider, model: clean(id), created: Date.parse(created_at) }));
}

/** Models from every provider with a key, newest first. Fails only when no provider answers. */
export async function listModels(
  keys: Partial<Record<AgentProvider, string>>,
  fetcher: typeof fetch = fetch,
): Promise<AgentModel[]> {
  const providers = (["openai", "anthropic"] as const).flatMap((provider) => {
    const key = keys[provider];
    return key ? [{ provider, key }] : [];
  });
  const results = await Promise.allSettled(
    providers.map(({ provider, key }) => providerModels(provider, key, fetcher)),
  );
  const models = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const [failed] = results.filter((result) => result.status === "rejected");
  if (failed && results.every((result) => result.status === "rejected")) {
    const reason = failed.reason instanceof Error ? failed.reason.message : "no answer";
    throw new Error(`Models unavailable: ${reason}`);
  }
  return models.sort((a, b) => b.created - a.created);
}
