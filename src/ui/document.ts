/** Lay out rich text for a given width: wrapped lines of styled runs. */

import type { DocBlock, Span, SpanStyle, Tone } from "../jira/adf";
import { cells, clip, splitGraphemes } from "../text";
import type { Run, Style } from "./canvas";

export type Line = Run[];

const SPAN_STYLES: Record<SpanStyle, Style> = {
  plain: "text",
  strong: "title",
  em: "italic",
  code: "code",
  link: "link",
  strike: "strike",
  mention: "mention",
  status: "status",
  muted: "muted",
  error: "error",
};

const TONE_STYLES: Record<Tone, Style> = {
  quote: "muted",
  info: "accent",
  note: "accent",
  success: "done",
  warning: "warning",
  error: "error",
};

/** Columns per nesting level, so nested items start under the parent's text after "1. ". */
const INDENT = 3;

const lineWidth = (line: Line): number => line.reduce((sum, run) => sum + cells(run.text), 0);

/** Append a run, merging it into the previous run when the style matches. */
function push(line: Line, text: string, style: Style): void {
  const last = line.at(-1);
  if (last && last.style === style) last.text += text;
  else line.push({ text, style });
}

/** Word-wrap spans to `width` columns. Continuation lines start with `hang`. */
export function wrapSpans(spans: Span[], width: number, first: Line = [], hang: Line = []): Line[] {
  const lines: Line[] = [];
  let line: Line = first.map((run) => ({ ...run }));
  let used = lineWidth(line);
  let empty = true;
  const start = (prefix: Line) => {
    line = prefix.map((run) => ({ ...run }));
    used = lineWidth(line);
    empty = true;
  };
  const breakLine = () => {
    lines.push(line);
    start(hang);
  };
  for (const span of spans) {
    const style = SPAN_STYLES[span.style];
    for (const token of span.text.match(/\n|[^\S\n]+|[^\s]+/g) ?? []) {
      if (token === "\n") {
        breakLine();
        continue;
      }
      const size = cells(token);
      if (/^\s+$/.test(token)) {
        if (!empty && used + size <= width) {
          push(line, token, style);
          used += size;
        }
        continue;
      }
      if (used + size > width && !empty) breakLine();
      if (used + size <= width) {
        push(line, token, style);
        used += size;
        empty = false;
        continue;
      }
      // A word longer than the line: split it across lines.
      for (const piece of splitGraphemes(token)) {
        const pieceSize = cells(piece);
        if (used + pieceSize > width && !empty) breakLine();
        push(line, piece, style);
        used += pieceSize;
        empty = false;
      }
    }
  }
  if (!empty || lines.length === 0) lines.push(line);
  // Trailing spaces would only pad the line.
  for (const done of lines) {
    const last = done.at(-1);
    if (last) last.text = last.text.trimEnd();
  }
  return lines;
}

/** List content sits together; everything else is separated by a blank line. */
const listish = (block: DocBlock): boolean =>
  block.kind === "text" && (block.marker !== undefined || (block.indent ?? 0) > 0);

export function layout(blocks: DocBlock[], width: number): Line[] {
  const lines: Line[] = [];
  let previous: DocBlock | undefined;
  for (const block of blocks) {
    const tight = previous && ((previous.kind === "text" && previous.keep) || (listish(previous) && listish(block)));
    if (previous && !tight) lines.push([]);
    lines.push(...layoutBlock(block, width));
    previous = block;
  }
  return lines;
}

function layoutBlock(block: DocBlock, width: number): Line[] {
  switch (block.kind) {
    case "text": {
      const pad = " ".repeat((block.indent ?? 0) * INDENT);
      if (block.marker === undefined) return wrapSpans(block.spans, width, [{ text: pad, style: "text" }], [{ text: pad, style: "text" }]);
      const marker = `${block.marker} `;
      return wrapSpans(
        block.spans,
        width,
        [{ text: pad + marker, style: "muted" }],
        [{ text: pad + " ".repeat(cells(marker)), style: "text" }],
      );
    }
    case "heading": {
      const style: SpanStyle = "strong";
      const lines = wrapSpans(block.spans.map((span) => ({ ...span, style })), width);
      // Top-level headings use the accent color, smaller ones stay bold.
      if (block.level <= 2) for (const line of lines) for (const run of line) run.style = "accentBold";
      return lines;
    }
    case "code":
      return block.lines.flatMap((text) => {
        const bar = { text: "│ ", style: "muted" as Style };
        if (!text) return [[bar]];
        return wrapSpans([{ text, style: "code" }], width, [bar], [bar]);
      });
    case "box": {
      const bar = { text: "▌ ", style: TONE_STYLES[block.tone] };
      return layout(block.blocks, Math.max(10, width - 2)).map((line) => [{ ...bar }, ...line]);
    }
    case "rule":
      return [[{ text: "─".repeat(Math.max(0, width)), style: "muted" }]];
    case "pre":
      return block.text.split("\n").map((text) => [{ text: clip(text, width), style: "text" }]);
    case "table":
      return layoutTable(block.rows, block.header, width);
  }
}

/** Column widths that fit `available` columns: narrow columns keep their
 * natural width, and the remaining room is shared among the wide ones. */
function fitColumns(natural: number[], available: number): number[] {
  const widths = natural.map(() => 0);
  let remaining = available;
  const order = natural.map((_, i) => i).sort((a, b) => (natural[a] ?? 0) - (natural[b] ?? 0));
  order.forEach((column, n) => {
    const share = Math.floor(remaining / (order.length - n));
    const width = Math.min(natural[column] ?? 0, Math.max(3, share));
    widths[column] = width;
    remaining -= width;
  });
  return widths;
}

function layoutTable(rows: Span[][][], header: boolean, width: number): Line[] {
  const columns = Math.max(0, ...rows.map((row) => row.length));
  if (columns === 0) return [];
  const textOf = (cell: Span[] | undefined) => (cell ?? []).map((span) => span.text).join("");
  const natural = Array.from({ length: columns }, (_, c) =>
    Math.max(1, ...rows.flatMap((row) => textOf(row[c]).split("\n").map(cells))),
  );
  // Each column adds "│ " before and " " after its text, plus the closing "│".
  const widths = fitColumns(natural, Math.max(columns * 3, width - columns * 3 - 1));
  const border = (left: string, middle: string, right: string): Line => [
    { text: left + widths.map((w) => "─".repeat(w + 2)).join(middle) + right, style: "muted" },
  ];
  const lines: Line[] = [border("┌", "┬", "┐")];
  rows.forEach((row, r) => {
    const isHeader = header && r === 0;
    const wrapped = widths.map((w, c) =>
      wrapSpans((row[c] ?? []).map((span) => (isHeader ? { ...span, style: "strong" } : span)), w),
    );
    const height = Math.max(1, ...wrapped.map((cell) => cell.length));
    for (let i = 0; i < height; i++) {
      const line: Line = [];
      widths.forEach((w, c) => {
        push(line, c === 0 ? "│ " : " │ ", "muted");
        const content = wrapped[c]?.[i] ?? [];
        for (const run of content) push(line, run.text, run.style);
        push(line, " ".repeat(Math.max(0, w - lineWidth(content))), "text");
      });
      push(line, " │", "muted");
      lines.push(line);
    }
    if (isHeader) lines.push(border("├", "┼", "┤"));
  });
  lines.push(border("└", "┴", "┘"));
  return lines;
}

const cache = new WeakMap<DocBlock[], { width: number; lines: Line[] }>();

/** Layout, reused while the same document is shown at the same width. */
export function layoutCached(blocks: DocBlock[], width: number): Line[] {
  const hit = cache.get(blocks);
  if (hit && hit.width === width) return hit.lines;
  const lines = layout(blocks, width);
  cache.set(blocks, { width, lines });
  return lines;
}
