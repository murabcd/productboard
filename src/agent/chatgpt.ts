import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import { version } from "../../package.json";
import { clean } from "../text";

const Reply = z.object({ id: z.number(), result: z.unknown().optional(), error: z.unknown().optional() });
const Account = z.object({ account: z.object({ type: z.string() }).nullable() });
const ModelPage = z.object({
  data: z.array(z.object({ model: z.string(), isDefault: z.boolean() })),
  nextCursor: z.string().nullable().optional(),
});

interface CodexRequests {
  initialize: { clientInfo: { name: string; version: string } };
  "account/read": { refreshToken: boolean };
  "model/list": { cursor?: string | null; includeHidden: boolean };
}

/** Read the Codex account type and model picker without requesting or storing credentials. */
export async function chatgptModels(signal?: AbortSignal): Promise<z.infer<typeof ModelPage>["data"]> {
  const codex = Bun.which("codex");
  if (!codex) throw new Error("Install the Codex CLI and run codex login.");
  const timeout = AbortSignal.timeout(15_000);
  const stop = signal ? AbortSignal.any([signal, timeout]) : timeout;
  stop.throwIfAborted();
  const child = spawn(codex, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "ignore"], signal: stop });
  const lines = createInterface({ input: child.stdout });
  const replies = lines[Symbol.asyncIterator]();
  let id = 0;
  // Close the iterator on process or pipe errors so pending requests settle.
  child.on("error", () => lines.close());
  child.stdin.on("error", () => lines.close());
  const request = async <Method extends keyof CodexRequests>(method: Method, params: CodexRequests[Method]) => {
    const requestId = ++id;
    child.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
    for (let next = await replies.next(); !next.done; next = await replies.next()) {
      const parsed = Reply.safeParse(JSON.parse(next.value));
      if (parsed.success && parsed.data.id === requestId) {
        if (parsed.data.error) break;
        return parsed.data.result;
      }
    }
    stop.throwIfAborted();
    throw new Error("Could not read the Codex account. Check that Codex is up to date.");
  };
  try {
    await request("initialize", { clientInfo: { name: "productboard", version } });
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    const { account } = Account.parse(await request("account/read", { refreshToken: false }));
    if (account?.type !== "chatgpt") throw new Error("Run codex login with your ChatGPT account.");
    const models: z.infer<typeof ModelPage>["data"] = [];
    const seen = new Set<string>();
    let cursor: string | null | undefined;
    do {
      const page = ModelPage.parse(await request("model/list", { cursor, includeHidden: false }));
      models.push(...page.data.map(({ model, isDefault }) => ({ model: clean(model), isDefault })));
      cursor = page.nextCursor;
      if (cursor) {
        if (seen.has(cursor)) throw new Error("Codex returned the same model page twice. Try again.");
        seen.add(cursor);
      }
    } while (cursor);
    return models;
  } catch (error) {
    if (timeout.aborted) throw new Error("Codex did not respond. Try again.");
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw new Error("Could not read the Codex account. Check that Codex is up to date.", { cause: error });
    }
    throw error;
  } finally {
    lines.close();
    child.kill();
  }
}
