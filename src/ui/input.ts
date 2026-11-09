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
  | "ctrl-c";

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

/** Something on screen the mouse can click. */
export type Target =
  | { kind: "view"; view: View }
  | { kind: "issue"; key: string }
  /** A picker choice, by its index among the visible choices. */
  | { kind: "choice"; index: number }
  /** The search box above the list. */
  | { kind: "box" };
