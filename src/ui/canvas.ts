/** A grid of terminal cells that knows how wide each character is. */

import { cells, clip, splitGraphemes } from "../text";
import type { Target } from "./input";

/** The answering scanner: its head and fading trail, then its dimmed resting blocks. */
export type ScannerStyle =
  | "trail0"
  | "trail1"
  | "trail2"
  | "trail3"
  | "trail4"
  | "trail5"
  | "idle0"
  | "idle1"
  | "idle2"
  | "idle3";

export type Style = TextStyle | ScannerStyle;

export type TextStyle =
  | "line"
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

/** Background layers for the workspace, controls, selections, and panels. */
export type Surface = "workspace" | "raised" | "selected" | "panel";

export interface Run {
  text: string;
  style: Style;
  surface?: Surface;
}

interface Cell {
  /** "" marks the right half of a double-width character. */
  ch: string;
  style: Style;
  surface: Surface;
}

/** A screen area, in cells. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What OpenTUI draws in a reserved area: an image preview or the Agent text box. */
export type Reserved = "image" | "composer";

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
  /** Areas OpenTUI draws over the frame itself. */
  private readonly reservations = new Map<Reserved, Rect>();

  constructor(
    readonly width: number,
    readonly height: number,
    surface: Surface = "workspace",
  ) {
    this.grid = Array.from({ length: height }, () =>
      Array.from({ length: width }, (): Cell => ({ ch: " ", style: "text", surface })),
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
  private set(row: Cell[], column: number, ch: string, style: Style, surface?: Surface): void {
    const cell = row[column];
    if (!cell) return;
    const left = row[column - 1];
    if (cell.ch === "" && left && ch !== "") left.ch = " ";
    const right = row[column + 1];
    if (right?.ch === "" && ch !== "" && cells(cell.ch) === 2) right.ch = " ";
    row[column] = { ch, style, surface: surface ?? cell.surface };
  }

  /** Color a stretch of one row without changing its text. */
  paint(y: number, x: number, width: number, surface: Surface): void {
    const row = this.grid[y];
    if (!row) return;
    for (const cell of row.slice(x, x + width)) cell.surface = surface;
  }

  /** Place an opaque child frame and translate its clickable regions. */
  paste(child: Canvas, x: number, y: number): void {
    child.grid.forEach((row, dy) => {
      const destination = this.grid[y + dy];
      if (!destination) return;
      row.forEach(({ ch, style, surface }, dx) => {
        if (x + dx >= 0 && x + dx < this.width) this.set(destination, x + dx, ch, style, surface);
      });
    });
    for (const region of child.regions) this.mark(y + region.y, x + region.x, region.width, region.target);
    for (const [name, rect] of child.reservations)
      this.reserve(name, { ...rect, left: rect.left + x, top: rect.top + y });
  }

  /** One row as runs of identically styled text. */
  runs(y: number): Run[] {
    const runs: Run[] = [];
    for (const cell of this.grid[y] ?? []) {
      const last = runs.at(-1);
      if (last && last.style === cell.style && last.surface === cell.surface) last.text += cell.ch;
      else runs.push({ text: cell.ch, style: cell.style, surface: cell.surface });
    }
    return runs;
  }

  /** Leave an area for OpenTUI to draw `name` in. */
  reserve(name: Reserved, rect: Rect): void {
    this.reservations.set(name, rect);
  }

  reserved(name: Reserved): Rect | undefined {
    return this.reservations.get(name);
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
