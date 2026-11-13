import { z } from "zod";
import {
  type AgentChoice,
  type AgentProvider,
  API_KEY_PROVIDERS,
  type ApiKeyProvider,
  type ModelRef,
  type Reasoning,
} from "../auth";
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

/** Parts of a model ID: a release date such as 20260301, and version numbers. */
const DATE_PART = /^\d{8}$/;
const NUMBER_PART = /^\d+$/;

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** How a model reads everywhere: "gpt-6.1-sol" is "GPT-6.1 Sol" and
 * "claude-sonnet-5-5" is "Claude Sonnet 5.5". A trailing date is left out. */
export function modelName(id: string): string {
  const words = id.split("-").filter((word) => !DATE_PART.test(word));
  if (words[0] === "gpt") return [`GPT-${words[1] ?? ""}`, ...words.slice(2).map(capitalize)].join(" ");
  const version = words.filter((word) => NUMBER_PART.test(word)).join(".");
  const name = words.filter((word) => !NUMBER_PART.test(word)).map(capitalize);
  return [...name, version].filter(Boolean).join(" ");
}

export const PROVIDER_NAMES: Record<AgentProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  chatgpt: "ChatGPT subscription",
};

const OpenAIModels = z.object({ data: z.array(z.object({ id: z.string(), created: z.number() })) });
const AnthropicModels = z.object({ data: z.array(z.object({ id: z.string(), created_at: z.string() })) });

const GENERATIONS: Record<ApiKeyProvider, RegExp> = {
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

async function providerModels(provider: ApiKeyProvider, key: string, fetcher: typeof fetch): Promise<AgentModel[]> {
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

interface ModelSources {
  keys: Partial<Record<ApiKeyProvider, string>>;
  subscription?: () => Promise<AgentModel[]>;
}

/** Load connected catalogs in parallel, keeping results from providers that answer. */
export async function listModels(
  { keys, subscription }: ModelSources,
  fetcher: typeof fetch = fetch,
): Promise<AgentModel[]> {
  const requests = API_KEY_PROVIDERS.flatMap((provider) => {
    const key = keys[provider];
    return key ? [providerModels(provider, key, fetcher)] : [];
  });
  if (subscription) requests.push(subscription());
  const results = await Promise.allSettled(requests);
  const models = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const subscriptionResult = subscription ? results.at(-1) : undefined;
  if (models.length === 0 && subscriptionResult?.status === "rejected") throw subscriptionResult.reason;
  const failed = results.find((result) => result.status === "rejected");
  if (failed && results.every((result) => result.status === "rejected")) {
    const reason = failed.reason instanceof Error ? failed.reason.message : "no answer";
    throw new Error(`Models unavailable: ${reason}`);
  }
  return models.sort((a, b) => b.created - a.created);
}
