import { setTimeout as delay } from "node:timers/promises";
import { clean } from "../text";
import type { AgentBackend } from "./chat";
import type { Conversation, Turn } from "./conversation";
import { AgentFailure, agentFailure } from "./failure";

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1500;
const MAX_RETRY_WAIT_MS = 30_000;

/** Own attempt callbacks, cancellation, retry policy and the terminal turn state. */
export async function runReply(
  backend: AgentBackend,
  thread: Conversation,
  turn: Turn,
  signal: AbortSignal,
  changed: () => void,
): Promise<void> {
  const history = thread.turns.slice(0, -1);
  let failure: AgentFailure | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let accepting = true;
    const priorTools = turn.tools;
    turn.state = { kind: "running", progress: { kind: "answering", attempt } };
    try {
      await untilStopped(
        backend.ask({
          thread: thread.id,
          prompt: turn.prompt,
          sprint: turn.sprint,
          images: turn.images,
          history,
          checkpoint: thread.checkpoint,
          signal,
          onIssues: (issues) => {
            if (!accepting || signal.aborted) return;
            for (const issue of issues) thread.issues.set(issue.key, issue);
            turn.issues = [...new Map([...turn.issues, ...issues].map((issue) => [issue.key, issue])).values()];
          },
          onText: (text, replace = false) => {
            if (!accepting || signal.aborted) return;
            turn.answer = (replace ? "" : turn.answer) + clean(text, true);
            changed();
          },
          onTools: (tools) => {
            if (!accepting || signal.aborted) return;
            turn.tools = [
              ...priorTools,
              ...tools.map((tool) => ({
                ...tool,
                id: attempt === 1 ? tool.id : `${attempt}/${tool.id}`,
                name: clean(tool.name),
                query: clean(tool.query),
                detail: clean(tool.detail),
              })),
            ];
            changed();
          },
        }),
        signal,
      );
      if (!turn.answer.trim()) throw new AgentFailure("empty");
      failure = undefined;
      break;
    } catch (error) {
      if (signal.aborted) break;
      failure = agentFailure(error);
    } finally {
      accepting = false;
      turn.tools = turn.tools.map((tool) =>
        tool.state === "running"
          ? {
              ...tool,
              state: signal.aborted ? "interrupted" : "failed",
              detail: signal.aborted ? "Stopped" : "Did not finish",
            }
          : tool,
      );
    }
    // Preserve partial replies for explicit retry; automatic retries are safe read-only attempts without text.
    if (
      !failure?.retryable ||
      turn.answer.trim() ||
      attempt === MAX_ATTEMPTS ||
      failure.retryAfterMs > MAX_RETRY_WAIT_MS
    )
      break;
    const wait = Math.max(RETRY_DELAY_MS, failure.retryAfterMs);
    turn.state = {
      kind: "running",
      progress: { kind: "retrying", attempt: attempt + 1, nextAt: Date.now() + wait, reason: failure.message },
    };
    changed();
    try {
      await delay(wait, undefined, { signal });
    } catch {
      break;
    }
  }
  const finished = Date.now();
  turn.state = signal.aborted
    ? { kind: "interrupted", finished }
    : failure
      ? { kind: "failed", finished, error: failure.message, reason: failure.kind }
      : { kind: "complete", finished };
}

export async function untilStopped<T>(reply: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const { promise, reject } = Promise.withResolvers<never>();
  const stop = () => reject(signal.reason);
  signal.addEventListener("abort", stop, { once: true });
  try {
    return await Promise.race([reply, promise]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
