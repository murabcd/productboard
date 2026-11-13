import type { Key, SearchEdit } from "./input";
import { rowOffset } from "./layout";

export type PickerKind =
  | "board"
  | "sprint-board"
  | "sprint"
  | "agent-context"
  | "agent-commands"
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
  filterChoices?: boolean;
  /** Repeat the current group heading when the first visible row is a choice. */
  keepGroupHeading?: boolean;
  /** Detail text sits at the trailing edge or in a fixed column. */
  detailLayout?: "trailing" | number;
  placement?: "dialog" | "completion" | "composer";
  onFinish?: () => void;
  /** Tab cycles these choice states; "all" shows every choice. */
  tabs?: string[];
  tab?: number;
}

type Row = { choice: PickerItem } | { heading: string } | null;

export class Picker<Kind extends string = PickerKind> {
  private text = "";
  private cursor = 0;
  private offset = 0;
  private readonly tabs: string[];
  private tab: number;
  readonly detailLayout: NonNullable<PickerOptions["detailLayout"]>;
  readonly placement: NonNullable<PickerOptions["placement"]>;
  readonly onFinish: PickerOptions["onFinish"];
  private readonly filterChoices: boolean;
  private readonly keepGroupHeading: boolean;
  private rows: Row[] = [];

  constructor(
    readonly kind: Kind,
    readonly title: string,
    private readonly choices: (query: string) => PickerItem[],
    options: PickerOptions = {},
  ) {
    this.detailLayout = options.detailLayout ?? "trailing";
    this.placement = options.placement ?? "dialog";
    this.onFinish = options.onFinish;
    this.filterChoices = options.filterChoices ?? true;
    this.keepGroupHeading = options.keepGroupHeading ?? false;
    this.tabs = options.tabs ?? [];
    this.tab = options.tab ?? 0;
    this.rebuild();
  }

  get query(): string {
    return this.text;
  }

  get searchEdit(): SearchEdit {
    return {
      owner: this,
      text: this.text,
      placeholder: "Search",
      limit: 120,
      change: (text) => this.setQuery(text),
    };
  }

  get composerHeaderRows(): number {
    return this.placement === "composer" ? 1 : 0;
  }

  setQuery(query: string): void {
    this.text = query;
    this.offset = 0;
    this.rebuild();
  }

  get tabName(): string | undefined {
    return this.tabs[this.tab];
  }

  get selected(): PickerItem | undefined {
    return this.choiceAt(this.cursor);
  }

  refresh(): void {
    this.rebuild(this.selected?.value);
  }

  private rebuild(previous?: string): void {
    const needle = this.filterChoices ? this.text.toLocaleLowerCase() : "";
    const tab = this.tabName;
    this.rows = [];
    let group: string | undefined;
    let first = -1;
    let current = -1;
    let retained = -1;
    for (const choice of this.choices(this.text)) {
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
    let start = this.offset;
    if (this.keepGroupHeading && capacity > 1 && this.choiceAt(start)?.group) {
      // Leave room for the heading without scrolling the selected choice out of view.
      if (this.cursor === start + capacity - 1) start++;
      const heading = this.choiceAt(start)?.group;
      if (heading) return [{ heading }, ...this.rows.slice(start, start + capacity - 1)];
    }
    return this.rows.slice(start, start + capacity);
  }

  choice(value: string): PickerItem | undefined {
    for (const row of this.rows) {
      if (row && "choice" in row && row.choice.value === value) return row.choice;
    }
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
