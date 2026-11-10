import { editLine, type Key } from "./input";

export type PickerKind =
  | "board"
  | "sprint"
  | "project"
  | "assignee"
  | "status"
  | "attachment"
  | "model"
  | "reasoning"
  | "cited"
  | "filter"
  | "display"
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

export class Picker {
  query = "";
  index = 0;
  /** The first row on screen, counting group headings. */
  offset = 0;
  closed = false;
  readonly tabs: string[];
  tab: number;

  constructor(
    readonly kind: PickerKind,
    readonly title: string,
    public choices: PickerItem[],
    options: PickerOptions = {},
  ) {
    this.tabs = options.tabs ?? [];
    this.tab = options.tab ?? 0;
    this.focusCurrent();
  }

  get tabName(): string {
    return this.tabs[this.tab] ?? "all";
  }

  focusCurrent(): void {
    this.index = Math.max(
      0,
      this.visible().findIndex((choice) => choice.current),
    );
  }

  visible(): PickerItem[] {
    const needle = this.query.toLocaleLowerCase();
    const tab = this.tabName;
    return this.choices.filter(
      (choice) =>
        (tab === "all" || choice.state === tab) &&
        `${choice.label} ${choice.detail} ${choice.group ?? ""}`.toLocaleLowerCase().includes(needle),
    );
  }

  /** Apply a key; `page` is how many choices fit on screen. */
  handle(key: Key, page: number): PickerItem | undefined {
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
