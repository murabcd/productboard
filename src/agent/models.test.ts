import { describe, expect, test } from "bun:test";
import { listModels, modelName } from "./models";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("Agent models", () => {
  test("lists GPT-6 and Claude 5 models from each provider with a key, newest first, each key only to its provider", async () => {
    const calls: [string, string][] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push([new URL(url).host, headers.get("authorization") ?? headers.get("x-api-key") ?? ""]);
      if (url.includes("openai.com"))
        return json({
          data: [
            { id: "gpt-6-luna", created: 300 },
            { id: "gpt-6.1-terra", created: 350 },
            { id: "gpt-5.6-luna", created: 320 },
            { id: "gpt-6-realtime", created: 400 },
            { id: "text-embedding-3-large", created: 500 },
          ],
        });
      return json({
        data: [
          { id: "claude-sonnet-5-5", created_at: "1970-01-01T00:05:00Z" },
          { id: "claude-sonnet-4-6", created_at: "1970-01-01T00:06:00Z" },
        ],
      });
    }) as typeof fetch;
    const models = await listModels({ openai: "sk-o", anthropic: "sk-a" }, fetcher);
    // Only GPT-6 and Claude 5 chat models.
    expect(models.map(({ provider, model }) => `${provider}/${model}`)).toEqual([
      "openai/gpt-6.1-terra",
      "openai/gpt-6-luna",
      "anthropic/claude-sonnet-5-5",
    ]);
    expect(calls.toSorted()).toEqual([
      ["api.anthropic.com", "sk-a"],
      ["api.openai.com", "Bearer sk-o"],
    ]);
  });

  test("one failing provider still lists the other; all failing explains why", async () => {
    const fetcher = (async (input: string | URL | Request) =>
      String(input).includes("openai.com") ? json({}, 401) : json({ data: [] })) as typeof fetch;
    expect(await listModels({ openai: "bad", anthropic: "sk-a" }, fetcher)).toEqual([]);
    expect(listModels({ openai: "bad" }, fetcher)).rejects.toThrow(
      "Models unavailable: could not list models (HTTP 401)",
    );
    expect(await listModels({}, fetcher)).toEqual([]);
  });

  test("model IDs read as names", () => {
    expect(modelName("gpt-6-luna")).toBe("GPT-6 Luna");
    expect(modelName("gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    expect(modelName("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(modelName("claude-opus-5-5-20260301")).toBe("Claude Opus 5.5");
  });
});
