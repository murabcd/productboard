import type { KeyEvent } from "@opentui/core";
import { splitGraphemes } from "../text";
import type { Key, KeyName } from "./input";

const NAMED: Record<string, KeyName> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  pageup: "pageup",
  pagedown: "pagedown",
  home: "home",
  end: "end",
  return: "enter",
  enter: "enter",
  linefeed: "enter",
  escape: "escape",
  tab: "tab",
  backspace: "backspace",
  delete: "backspace",
};

export function toKeys(key: Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift" | "sequence" | "super">): Key[] {
  if ((key.ctrl && key.name === "k") || (key.super && key.name === "k")) return [{ name: "commands" }];
  if (key.ctrl && key.name === "n") return [{ name: "agent-new" }];
  if (key.ctrl && key.name === "x") return [{ name: "agent-stop" }];
  if (key.ctrl && key.name === "up") return [{ name: "agent-previous" }];
  if (key.ctrl && key.name === "down") return [{ name: "agent-next" }];
  if (key.ctrl && key.name === "o") return [{ name: "agent-cited" }];
  if (key.ctrl && key.name === "c") return [{ name: "ctrl-c" }];
  if (key.shift && !key.ctrl && !key.meta && !key.super) {
    if (key.name === "up" || key.name === "down") return [{ name: key.name, shift: true }];
  }
  const named = NAMED[key.name];
  if (named) return named === "tab" && key.shift ? [] : [{ name: named }];
  if (key.ctrl || key.meta) return [];
  return textKeys(key.sequence);
}

/** Typed or pasted text, one key per character, without control characters. */
export function textKeys(text: string): Key[] {
  return splitGraphemes(text)
    .filter((ch) => ch >= " " && ch !== "\u007f")
    .map((ch) => ({ text: ch }));
}
