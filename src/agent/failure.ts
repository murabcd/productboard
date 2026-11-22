import { ClientError } from "eve/client";
import { z } from "zod";

export const FailureKind = z.enum([
  "authentication",
  "billing",
  "context",
  "model",
  "filtered",
  "request",
  "rate-limit",
  "provider",
  "network",
  "timeout",
  "empty",
  "restarted",
  "startup",
  "unknown",
]);
export type FailureKind = z.infer<typeof FailureKind>;
const FAILURES: Record<FailureKind, { message: string; retry: boolean }> = {
  authentication: {
    message: "The model provider rejected your credentials. Run productboard --agent-login to reconnect.",
    retry: false,
  },
  billing: {
    message: "The model provider's quota or credit is exhausted. Check your account or choose /models.",
    retry: false,
  },
  context: { message: "The conversation exceeds the model's context limit. Use /compact, then retry.", retry: false },
  model: { message: "This model is unavailable for your account. Choose another with /models.", retry: false },
  filtered: {
    message: "The model provider filtered this response. Revise the question before retrying.",
    retry: false,
  },
  request: { message: "The model provider rejected this request. Check attachments or choose /models.", retry: false },
  "rate-limit": { message: "The model provider is rate-limiting requests. Wait briefly and retry.", retry: true },
  provider: { message: "The model provider is temporarily unavailable. Try again.", retry: true },
  network: { message: "The connection to Agent was lost. Check your connection and retry.", retry: true },
  timeout: { message: "Agent timed out. Try again or choose a faster model with /models.", retry: true },
  empty: { message: "Agent returned an empty reply. Try again.", retry: true },
  restarted: { message: "Agent restarted. Send the question again.", retry: false },
  startup: { message: "Could not start Eve. Install Node.js 24 and run bun install.", retry: false },
  unknown: { message: "Agent could not finish the reply. Retry or choose another model with /models.", retry: false },
};

/** Controlled messages keep provider bodies, headers and credentials out of saved chats. */
export class AgentFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly retryAfterMs = 0,
  ) {
    super(FAILURES[kind].message);
  }
  get retryable(): boolean {
    return FAILURES[this.kind].retry;
  }
}

const FAILURE_RULES: readonly { kind: FailureKind; statuses: readonly number[]; pattern: RegExp }[] = [
  {
    kind: "context",
    statuses: [413],
    pattern: /context.{0,25}(length|window|limit)|token.{0,20}limit|prompt.{0,15}too long/,
  },
  { kind: "billing", statuses: [402], pattern: /insufficient.quota|quota.exceeded|billing|credit|balance/ },
  { kind: "authentication", statuses: [401, 403], pattern: /authenticat|unauthorized|invalid.{0,15}(key|token)/ },
  { kind: "model", statuses: [404], pattern: /model.not.found|model.{0,15}(unavailable|not supported)/ },
  { kind: "filtered", statuses: [], pattern: /content.filter|safety|filtered/ },
  { kind: "rate-limit", statuses: [429], pattern: /rate.limit|too many requests/ },
  { kind: "timeout", statuses: [408], pattern: /timed.out|timeout|stopped responding/ },
  { kind: "provider", statuses: [503], pattern: /overloaded|temporarily.unavailable/ },
  { kind: "network", statuses: [], pattern: /network|fetch failed|connection|econn|socket|stream ended/ },
  { kind: "request", statuses: [400], pattern: /invalid.request/ },
];
const SECONDS = /^\d+$/;

export function classifyFailure(message: string, status = 0): AgentFailure {
  const text = message.toLowerCase();
  const code = status >= 500 ? 503 : status;
  return new AgentFailure(
    FAILURE_RULES.find((rule) => rule.statuses.includes(code) || rule.pattern.test(text))?.kind ?? "unknown",
  );
}

export function agentFailure(error: unknown): AgentFailure {
  if (error instanceof AgentFailure) return error;
  if (error instanceof ClientError) {
    const failure = classifyFailure(`${error.code} ${error.body}`, error.status);
    const retry = error.headers["retry-after"];
    const seconds = retry && SECONDS.test(retry) ? Number(retry) : retry ? (Date.parse(retry) - Date.now()) / 1000 : 0;
    return new AgentFailure(failure.kind, Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0);
  }
  return classifyFailure(error instanceof Error ? error.message : "");
}
