import { editLine, type Key } from "./input";
import { rowOffset } from "./layout";

export type PickerKind =
  | "board"
  | "sprint-filter-board"
  | "sprint"
  | "sprint-filter"
  | "sprint-context"
  | "project"
  | "assignee"
  | "status"
  | "attachment"
  | "model"
  | "reasoning"
  | "cited"
  | "filter"
  | "display"
  | "theme"
  | "commands";

export interface PickerItem {
  value: string;
  label: string;
  detail: string;
  /** The tab it is listed under, e.g. a sprint's "active". */
  state?: string;
  /** The heading it is listed under, e.g. a model's provider. */
  group?: string;
  /** What is chosen now; marked ● and focused when the list opens. */
  current?: boolean;
  run(): void;
}

export interface PickerOptions {
  /** Tab cycles these choice states; "all" shows every choice. */
  tabs?: string[];
  tab?: number;
}

type Row = { choice: PickerItem } | { heading: string } | null;

export class Picker {
  private text = "";
  private cursor = 0;
  private offset = 0;
  private readonly tabs: string[];
  private tab: number;
  private rows: Row[] = [];

  constructor(
    readonly kind: PickerKind,
    readonly title: string,
    private choices: PickerItem[],
    options: PickerOptions = {},
  ) {
    this.tabs = options.tabs ?? [];
    this.tab = options.tab ?? 0;
    this.rebuild();
  }

  get query(): string {
    return this.text;
  }

  get tabName(): string | undefined {
    return this.tabs[this.tab];
  }

  get selected(): PickerItem | undefined {
    return this.choiceAt(this.cursor);
  }

  replace(choices: PickerItem[]): void {
    const value = this.selected?.value;
    this.choices = choices;
    this.rebuild(value);
  }

  private rebuild(previous?: string): void {
    const needle = this.text.toLocaleLowerCase();
    const tab = this.tabName;
    this.rows = [];
    let group: string | undefined;
    let first = -1;
    let current = -1;
    let retained = -1;
    for (const choice of this.choices) {
      if (tab && tab !== "all" && choice.state && choice.state !== tab) continue;
      if (!`${choice.label} ${choice.detail} ${choice.group ?? ""}`.toLocaleLowerCase().includes(needle)) continue;
      if (choice.group && choice.group !== group) {
        if (this.rows.length) this.rows.push(null);
        this.rows.push({ heading: choice.group });
      }
      group = choice.group;
      const row = this.rows.length;
      if (first < 0) first = row;
      if (choice.current && current < 0) current = row;
      if (choice.value === previous) retained = row;
      this.rows.push({ choice });
    }
    this.cursor = retained >= 0 ? retained : current >= 0 && !needle ? current : Math.max(0, first);
  }

  private choiceAt(index: number): PickerItem | undefined {
    const row = this.rows[index];
    return row && "choice" in row ? row.choice : undefined;
  }

  window(capacity: number): readonly Row[] {
    this.offset = rowOffset(this.offset, this.cursor, this.rows.length, capacity);
    return this.rows.slice(this.offset, this.offset + capacity);
  }

  click(value: string): PickerItem | undefined {
    const index = this.rows.findIndex((row) => row && "choice" in row && row.choice.value === value);
    if (index < 0) return;
    if (this.cursor === index) return this.selected;
    this.cursor = index;
  }

  move(direction: -1 | 1, distance = 1): void {
    let next = this.cursor;
    for (let row = this.cursor + direction; row >= 0 && row < this.rows.length; row += direction) {
      if (direction * (row - this.cursor) > distance && next !== this.cursor) break;
      if (this.choiceAt(row)) next = row;
    }
    this.cursor = next;
  }

  handle(key: Key, capacity: number): PickerItem | "dismiss" | undefined {
    const edited = editLine(this.text, key, 120);
    if (edited !== undefined) {
      this.text = edited;
      this.offset = 0;
      this.rebuild();
      return;
    }
    if ("text" in key) return;
    switch (key.name) {
      case "escape":
      case "ctrl-c":
        return "dismiss";
      case "enter":
        return this.selected;
      case "tab":
        if (this.tabs.length) {
          this.tab = (this.tab + 1) % this.tabs.length;
          this.offset = 0;
          this.rebuild();
        }
        return;
      case "down":
        this.move(1);
        return;
      case "up":
        this.move(-1);
        return;
      case "pagedown":
        this.move(1, capacity);
        return;
      case "pageup":
        this.move(-1, capacity);
    }
  }
}
