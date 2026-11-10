/** Keyboard and mouse input as the dashboard sees it, independent of the terminal library. */

import type { View } from "../jira/query";

export type KeyName =
  | "up"
  | "down"
  | "left"
  | "right"
  | "pageup"
  | "pagedown"
  | "home"
  | "end"
  | "enter"
  | "escape"
  | "tab"
  | "backspace"
  | "ctrl-c"
  | "commands"
  | "agent-new"
  | "agent-stop"
  | "agent-previous"
  | "agent-next"
  | "agent-cited";

/** A named key, or one typed character. */
export type Key = { name: KeyName } | { text: string };

/** One identifier per key for binding tables: the key's name or its character. */
export const keyId = (key: Key): string => ("name" in key ? key.name : key.text);

/** A binding table from space-separated key ids, e.g. "j down", to actions. */
export function bindings<T>(table: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(table).flatMap(([ids, action]) => ids.split(" ").map((id) => [id, action] as const)));
}

/** Apply a typing key to a one-line input. Returns the new text, or
 * undefined when the key is not an edit (Enter, Escape, arrows…). */
export function editLine(value: string, key: Key, max: number): string | undefined {
  if ("text" in key) return value.length < max ? value + key.text : value;
  if (key.name === "backspace") return value.slice(0, -1);
  return undefined;
}

/** Buttons in the header, footer and peek panel; each matches a key. */
export type Action =
  | "filter"
  | "display"
  | "board"
  | "sprint"
  | "brief"
  | "peek"
  | "details"
  | "refresh"
  | "help"
  | "commands"
  | "model"
  | "reasoning"
  | "load-more";

/** Something on screen the mouse can click. */
export type Target =
  | { kind: "action"; action: Action }
  /** The open dialog's surface, and its esc button. */
  | { kind: "dialog" }
  | { kind: "dismiss" }
  /** The peek panel; the wheel over it scrolls the panel. */
  | { kind: "peek" }
  /** A group heading; a click folds or unfolds it. */
  | { kind: "group"; label: string }
  | { kind: "view"; view: View }
  | { kind: "issue"; key: string }
  | { kind: "choice"; value: string }
  /** The search box above the list. */
  | { kind: "box" }
  | { kind: "agent"; action: "tab" | "new" | "previous" | "next" | "sprint" | "board" }
  | { kind: "agent-cite"; key: string };
