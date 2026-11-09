/** Searchable keyboard picker shared by boards, sprints, projects, people and files. */

import type { Choice } from "../jira/types";
import { editLine, type Key } from "./input";

export type PickerKind = "board" | "sprint" | "project" | "assignee" | "attachment";

export class Picker {
  query = "";
  index = 0;
  offset = 0;
  closed = false;

  constructor(
    readonly kind: PickerKind,
    readonly title: string,
    public choices: Choice[],
    /** Tab cycles these choice states; "all" shows every choice. */
    readonly tabs: string[] = [],
    public tab = 0,
  ) {}

  get tabName(): string {
    return this.tabs[this.tab] ?? "all";
  }

  visible(): Choice[] {
    const needle = this.query.toLocaleLowerCase();
    const tab = this.tabName;
    return this.choices.filter(
      (choice) =>
        (tab === "all" || choice.state === tab) &&
        `${choice.label} ${choice.detail}`.toLocaleLowerCase().includes(needle),
    );
  }

  /** Apply a key; `page` is how many choices fit on screen. */
  handle(key: Key, page: number): Choice | undefined {
    const edited = editLine(this.query, key, 120);
    if (edited !== undefined) {
      this.query = edited;
      this.index = 0;
      this.offset = 0;
      return undefined;
    }
    if ("text" in key) return undefined;
    const choices = this.visible();
    switch (key.name) {
      case "escape":
      case "ctrl-c":
        this.closed = true;
        break;
      case "enter":
        return choices[Math.min(this.index, choices.length - 1)];
      case "tab":
        if (this.tabs.length) {
          this.tab = (this.tab + 1) % this.tabs.length;
          this.index = 0;
          this.offset = 0;
        }
        break;
      case "down":
        this.index += 1;
        break;
      case "up":
        this.index -= 1;
        break;
      case "pagedown":
        this.index += page;
        break;
      case "pageup":
        this.index -= page;
        break;
      default:
        break;
    }
    this.index = Math.max(0, Math.min(this.index, this.visible().length - 1));
    return undefined;
  }
}
