/** Read-only HTTPS access to Jira Cloud with an API token. */

import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { clean } from "../text";
import { decode } from "./parse";

export interface Credentials {
  /** e.g. "example.atlassian.net" */
  site: string;
  email: string;
  token: string;
}

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** Seconds between attempts for throttled, failing or unreachable requests. */
export const RETRY_DELAYS = [1, 3, 6];
/** Requests normally answer in under a second; a stalled one is retried. */
const TIMEOUT_MS = 8_000;
/** Some VPNs silently drop a share of new connections, which then hang for
 * seconds. A read with no answer by now is sent again; the first answer wins. */
const HEDGE_MS = 2_000;
/** Longest Retry-After the app will honor before giving up on a request. */
const MAX_WAIT_SECONDS = 30;
const MAX_PARALLEL = 8;
/** Background reads (boards, sprints) never take the last slots, so the list
 * on screen loads at once even while the board catalog is still loading. */
const MAX_BACKGROUND = 4;
/** Largest attachment the app downloads for a preview. */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

type Params = Record<string, string | number | undefined>;
type WaitingRead = PromiseWithResolvers<void>;

/** Foreground reads are what the user is waiting for; they go first. */
export type Priority = "foreground" | "background";

export interface ReadOptions {
  priority?: Priority;
  signal?: AbortSignal;
}

export class JiraHttp {
  private readonly closing = new AbortController();
  private active = 0;
  private readonly waiting: Record<Priority, WaitingRead[]> = { foreground: [], background: [] };

  constructor(
    readonly credentials: Credentials,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sleep = pause,
  ) {}

  get<T>(
    path: string,
    params: Params,
    schema: z.ZodType<T>,
    what: string,
    priority: Priority = "foreground",
  ): Promise<T> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) query.set(name, String(value));
    }
    const suffix = query.size ? `?${query}` : "";
    return this.request("GET", `${path}${suffix}`, undefined, schema, what, { priority });
  }

  /** Jira's search is a POST, but it only reads. */
  post<T>(path: string, body: unknown, schema: z.ZodType<T>, what: string, options?: ReadOptions): Promise<T> {
    return this.request("POST", path, body, schema, what, options);
  }

  close(): void {
    this.closing.abort(new JiraError("Dashboard closed"));
  }

  /** Download a file. Jira redirects downloads to its media service; the
   * token is only ever sent to the Jira site itself. */
  async download(path: string): Promise<Uint8Array> {
    let response = await this.send(`https://${this.credentials.site}${path}`, "foreground", {
      headers: this.auth(),
      redirect: "manual",
    });
    const location = response.headers.get("Location");
    if (response.status >= 300 && response.status < 400 && location) {
      response = await this.send(new URL(location, `https://${this.credentials.site}`).href, "foreground", {});
    }
    if (Number(response.headers.get("Content-Length")) > MAX_DOWNLOAD_BYTES) {
      throw new JiraError("This file is too large to preview. Press o to open it in Helium.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) {
      throw new JiraError("This file is too large to preview. Press o to open it in Helium.");
    }
    return bytes;
  }

  private auth(): Record<string, string> {
    const { email, token } = this.credentials;
    return { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` };
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    what: string,
    { priority = "foreground", signal }: ReadOptions = {},
  ): Promise<T> {
    const response = await this.send(`https://${this.credentials.site}${path}`, priority, {
      method,
      signal,
      headers: {
        ...this.auth(),
        Accept: "application/json",
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return decode(schema, await response.json(), what);
  }

  /** Fetch with retries; returns a successful or redirect response, else throws. */
  private async send(url: string, priority: Priority, init: RequestInit): Promise<Response> {
    const stop = init.signal ? AbortSignal.any([this.closing.signal, init.signal]) : this.closing.signal;
    for (let attempt = 0; ; attempt++) {
      stop.throwIfAborted();
      let response: Response;
      try {
        response = await this.slot(priority, stop, () => {
          const signal = AbortSignal.any([stop, AbortSignal.timeout(TIMEOUT_MS)]);
          return this.hedged(url, init, signal);
        });
      } catch (error) {
        stop.throwIfAborted();
        if (attempt >= RETRY_DELAYS.length) {
          const timedOut = error instanceof DOMException && error.name === "TimeoutError";
          throw new JiraError(
            timedOut ? "Jira timed out. Press r to retry." : "Could not reach Jira. Press r to retry.",
          );
        }
        await this.sleep((RETRY_DELAYS[attempt] ?? 0) * 1000, stop);
        continue;
      }
      if (response.status < 400) return response;
      const message = await failure(response);
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt >= RETRY_DELAYS.length) throw new JiraError(message, response.status);
      const retryAfter = Number(response.headers.get("Retry-After"));
      const wait = retryAfter > 0 ? retryAfter : (RETRY_DELAYS[attempt] ?? 0);
      if (wait > MAX_WAIT_SECONDS) throw new JiraError(message, response.status);
      await this.sleep(wait * 1000, stop);
    }
  }

  /** Fetch, and fetch again if the first attempt has not answered in
   * HEDGE_MS. Every request is a read, so a duplicate is harmless. */
  private async hedged(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    const own = [new AbortController(), new AbortController()];
    const attempts = own.map(async (mine, n) => {
      const stop = AbortSignal.any([signal, mine.signal]);
      if (n > 0) await pause(n * HEDGE_MS, stop);
      const response = await this.fetcher(url, { ...init, signal: stop });
      for (const other of own) if (other !== mine) other.abort();
      return response;
    });
    try {
      return await Promise.any(attempts);
    } catch (error) {
      throw error instanceof AggregateError ? error.errors[0] : error;
    }
  }

  /** Run at most MAX_PARALLEL requests at once; waiting foreground requests go first. */
  private async slot<T>(priority: Priority, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    const limit = priority === "foreground" ? MAX_PARALLEL : MAX_BACKGROUND;
    if (this.active >= limit) {
      const waiting = Promise.withResolvers<void>();
      const queue = this.waiting[priority];
      const cancel = () => {
        const at = queue.indexOf(waiting);
        if (at === -1) return;
        queue.splice(at, 1);
        waiting.reject(signal.reason);
      };
      queue.push(waiting);
      signal.addEventListener("abort", cancel, { once: true });
      try {
        await waiting.promise;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    } else {
      this.active++;
    }
    try {
      signal.throwIfAborted();
      return await run();
    } finally {
      this.active--;
      const next =
        this.waiting.foreground.shift() ?? (this.active < MAX_BACKGROUND ? this.waiting.background.shift() : undefined);
      if (next) {
        this.active++;
        next.resolve();
      }
    }
  }
}

/** Wait `ms`; rejects early when `signal` aborts. */
const pause = (ms: number, signal: AbortSignal): Promise<void> => delay(ms, undefined, { signal });

const ErrorPayload = z.object({
  errorMessages: z.array(z.string().nullable().catch(null)).catch([]),
  errors: z.record(z.string(), z.string().nullable().catch(null)).catch({}),
});

/** A short, readable reason for a failed Jira response. */
async function failure(response: Response): Promise<string> {
  if (response.status === 401) return "Jira rejected your API token. Run board --login to set a new one.";
  if (response.status === 429) return "Jira is rate-limiting requests. Try again in a minute.";
  const body = ErrorPayload.safeParse(await response.json().catch(() => undefined));
  const detail = body.success ? [...body.data.errorMessages, ...Object.values(body.data.errors)] : [];
  const text = clean(detail.filter((entry) => entry !== null).join(" · ")).slice(0, 300);
  if (response.status === 403) return text || "You don't have access to this in Jira.";
  return text || `Jira returned an error (${response.status}). Press r to retry.`;
}
