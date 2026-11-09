/** A grid of terminal cells that knows how wide each character is. */

import { cells, clip, splitGraphemes } from "../text";
import type { Target } from "./input";

export type Style =
  | "text"
  | "title"
  | "muted"
  | "mutedBold"
  | "accent"
  | "accentBold"
  | "done"
  | "italic"
  | "code"
  | "link"
  | "strike"
  | "status"
  | "review"
  | "ship"
  | "warning"
  | "mention"
  | "error"
  | "selection"
  | "selectedBold";

export interface Run {
  text: string;
  style: Style;
}

interface Cell {
  /** "" marks the right half of a double-width character. */
  ch: string;
  style: Style;
}

/** A clickable stretch of one row. */
interface Region {
  y: number;
  x: number;
  width: number;
  target: Target;
}

export class Canvas {
  private readonly grid: Cell[][];
  private readonly regions: Region[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.grid = Array.from({ length: height }, () =>
      Array.from({ length: width }, (): Cell => ({ ch: " ", style: "text" })),
    );
  }

  /** Write text at (y, x), clipped to the screen and to `limit` columns. */
  put(y: number, x: number, text: string, style: Style, limit?: number): void {
    const row = this.grid[y];
    if (!row || x < 0 || x >= this.width) return;
    const available = Math.min(this.width - x - 1, limit ?? Number.POSITIVE_INFINITY);
    let column = x;
    for (const segment of splitGraphemes(clip(text, available))) {
      const size = cells(segment);
      if (size === 0) {
        const previous = row[column - 1];
        if (previous && column > x) previous.ch += segment;
        continue;
      }
      if (column + size > this.width) break;
      this.set(row, column, segment, style);
      if (size === 2) this.set(row, column + 1, "", style);
      column += size;
    }
  }

  /** Overwrite one cell without leaving half of a wide character behind. */
  private set(row: Cell[], column: number, ch: string, style: Style): void {
    const cell = row[column];
    if (!cell) return;
    const left = row[column - 1];
    if (cell.ch === "" && left && ch !== "") left.ch = " ";
    const right = row[column + 1];
    if (right?.ch === "" && ch !== "" && cells(cell.ch) === 2) right.ch = " ";
    row[column] = { ch, style };
  }

  /** One row as runs of identically styled text. */
  runs(y: number): Run[] {
    const runs: Run[] = [];
    for (const cell of this.grid[y] ?? []) {
      const last = runs.at(-1);
      if (last && last.style === cell.style) last.text += cell.ch;
      else runs.push({ text: cell.ch, style: cell.style });
    }
    return runs;
  }

  /** Make `width` cells of row `y` from column `x` clickable. */
  mark(y: number, x: number, width: number, target: Target): void {
    this.regions.push({ y, x, width, target });
  }

  /** What a click at (x, y) hits; later marks win. */
  targetAt(x: number, y: number): Target | undefined {
    return this.regions.findLast((r) => r.y === y && x >= r.x && x < r.x + r.width)?.target;
  }

  text(y: number): string {
    return (this.grid[y] ?? []).map((cell) => cell.ch).join("");
  }
}
