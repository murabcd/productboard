import { READ_CACHE_MS, RecentCache } from "../cache";
import type { JiraClient } from "../jira/client";
import type { Detail } from "../jira/types";
import { message } from "../state/workspace";

export interface IssueRead {
  readonly key: string;
  state:
    | { kind: "loading"; data: Detail | null }
    | { kind: "ready"; data: Detail }
    | { kind: "error"; data: Detail | null; message: string };
}

export class IssueDetails {
  private readonly pending = new Map<string, IssueRead>();
  private readonly cache = new RecentCache<string, Detail>(50);

  constructor(
    private readonly fetch: JiraClient["detail"],
    private readonly changed: (read: IssueRead) => void,
    private readonly now = Date.now,
  ) {}

  open(key: string): IssueRead {
    const pending = this.pending.get(key);
    if (pending) return pending;
    const cached = this.cache.get(key);
    const read: IssueRead = {
      key,
      state: cached ? { kind: "ready", data: cached.value } : { kind: "loading", data: null },
    };
    if (!cached || this.now() >= cached.updated + READ_CACHE_MS) void this.reload(read);
    return read;
  }

  async reload(read: IssueRead): Promise<void> {
    const { key } = read;
    if (this.pending.has(key)) return;
    this.pending.set(key, read);
    const { data } = read.state;
    read.state = { kind: "loading", data };
    let result: IssueRead["state"];
    try {
      result = { kind: "ready", data: await this.fetch(key) };
    } catch (error) {
      result = { kind: "error", data, message: message(error) };
    }
    if (this.pending.get(key) !== read) return;
    this.pending.delete(key);
    read.state = result;
    if (result.kind === "ready") this.cache.set(key, result.data, this.now());
    this.changed(read);
  }

  dispose(): void {
    this.pending.clear();
    this.cache.clear();
  }
}
