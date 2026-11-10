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

  constructor(
    private readonly fetch: JiraClient["detail"],
    private readonly changed: (read: IssueRead) => void,
  ) {}

  open(key: string): IssueRead {
    const pending = this.pending.get(key);
    if (pending) return pending;
    const read: IssueRead = { key, state: { kind: "loading", data: null } };
    void this.reload(read);
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
    this.changed(read);
  }

  dispose(): void {
    this.pending.clear();
  }
}
