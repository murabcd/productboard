import { setTimeout } from "node:timers/promises";
import type { DraftReference } from "../agent/draft";
import type { JiraClient } from "../jira/client";
import { type Issue, type Sprint, sprintChoice } from "../jira/types";
import { message } from "../state/workspace";
import type { PickerItem } from "./picker";

const CONTEXT_RESULTS = 12;
const RECENT_RESULTS = 4;

type Search =
  | { kind: "pending"; controller: AbortController }
  | { kind: "results"; issues: Issue[] }
  | { kind: "error"; message: string };

export class ContextPicker {
  private search?: Search;
  private reference?: DraftReference;

  constructor(
    private readonly findIssues: JiraClient["findIssues"],
    private readonly changed: () => void,
  ) {}

  get status(): string {
    if (this.search?.kind === "pending") return "Searching Jira…";
    if (this.search?.kind === "error") return `Jira search failed: ${this.search.message}`;
    return "";
  }

  close(): void {
    if (this.search?.kind === "pending") this.search.controller.abort();
    this.search = undefined;
  }

  async lookup(query: string): Promise<void> {
    this.close();
    const text = query.trim();
    if (text.length < 2) {
      this.changed();
      return;
    }
    const controller = new AbortController();
    this.search = { kind: "pending", controller };
    const { signal } = controller;
    this.changed();
    try {
      await setTimeout(180, undefined, { signal });
      const issues = await this.findIssues(text, signal);
      if (signal.aborted) return;
      this.search = { kind: "results", issues };
    } catch (error) {
      if (signal.aborted) return;
      this.search = { kind: "error", message: message(error) };
    }
    this.changed();
  }

  items(query: string, sprints: readonly Sprint[], issues: readonly Issue[], sprintId?: number): PickerItem[] {
    const needle = query.trim().toLocaleLowerCase();
    const limit = needle ? CONTEXT_RESULTS : RECENT_RESULTS;
    const matches = (text: string) => text.toLocaleLowerCase().includes(needle);
    const tasks = new Map<string, Issue>();
    if (this.search?.kind === "results") {
      for (const issue of this.search.issues) tasks.set(issue.key, issue);
    }
    const local = issues.filter(({ key, summary }) => !tasks.has(key) && matches(`${key} ${summary}`)).slice(0, limit);
    for (const issue of local) tasks.set(issue.key, issue);
    return [
      ...sprints
        .filter(({ name }) => matches(name))
        .slice(0, limit)
        .map((sprint) => ({
          ...sprintChoice(sprint),
          group: "Sprints",
          current: sprint.id === sprintId,
          run: () => {
            this.reference = { kind: "sprint", sprint: { id: sprint.id, name: sprint.name } };
          },
        })),
      ...Array.from(tasks.values(), ({ key, summary, status }) => ({
        value: key,
        label: `${key}  ${summary}`,
        detail: status,
        group: "Tasks",
        run: () => {
          this.reference = { kind: "issue", key };
        },
      })),
    ];
  }

  takeReference(): DraftReference | undefined {
    const reference = this.reference;
    this.reference = undefined;
    return reference;
  }
}
