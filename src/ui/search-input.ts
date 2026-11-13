import { InputRenderable, type KeyEvent, type RenderContext } from "@opentui/core";
import { clean } from "../text";
import type { SearchArea } from "./canvas";
import type { Key, KeyName, SearchEdit } from "./input";
import type { resolveTheme } from "./theme";

type Theme = ReturnType<typeof resolveTheme>;
const SEARCH_ACTIONS = new Set<KeyName>([
  "up",
  "down",
  "pageup",
  "pagedown",
  "enter",
  "tab",
  "escape",
  "ctrl-c",
  "commands",
]);

/** List navigation and confirmation stay with the current view or picker. */
export function isSearchAction(keys: Key[]): boolean {
  return keys.some((key) => "name" in key && SEARCH_ACTIONS.has(key.name));
}

/** One native editor for the active search field, with the scope owning its value. */
export class SearchInput extends InputRenderable {
  private owner?: SearchEdit["owner"];
  private theme?: Theme;

  constructor(ctx: RenderContext) {
    super(ctx, {
      id: "search-input",
      position: "absolute",
      visible: false,
    });
  }

  private sync(edit: SearchEdit): void {
    const changedOwner = this.owner !== edit.owner;
    this.owner = edit.owner;
    this.maxLength = edit.limit;
    if (changedOwner || this.value !== edit.text) {
      this.setText(edit.text);
      this.cursorOffset = this.editBuffer.getEOL().offset;
    }
    if (this.placeholder !== edit.placeholder) this.placeholder = edit.placeholder;
  }

  key(edit: SearchEdit, event: KeyEvent): void {
    this.sync(edit);
    this.handleKeyPress(event);
    if (this.value !== edit.text) edit.change(this.value);
  }

  paste(edit: SearchEdit, text: string): void {
    this.sync(edit);
    this.insertText(clean(text));
    if (this.value !== edit.text) edit.change(this.value);
  }

  place(edit: SearchEdit | undefined, area: SearchArea | undefined, theme: Theme): void {
    if (!edit || !area) {
      this.owner = undefined;
      if (this.visible) {
        if (this.focused) this.blur();
        this.visible = false;
      }
      return;
    }
    this.sync(edit);
    const { left, top, width, surface } = area;
    if (!this.visible || this.x !== left || this.y !== top || this.width !== width)
      Object.assign(this, { x: left, y: top, width, visible: true });
    const text = theme.styles.text.fg;
    const background = theme.surfaces[surface];
    if (this.theme !== theme || !this.backgroundColor.equals(background)) {
      this.theme = theme;
      Object.assign(this, {
        placeholderColor: theme.styles.muted.fg,
        textColor: text,
        focusedTextColor: text,
        backgroundColor: background,
        focusedBackgroundColor: background,
        cursorColor: text,
        selectionBg: theme.surfaces.selected,
        selectionFg: text,
      });
    }
    if (!this.focused) this.focus();
  }
}
