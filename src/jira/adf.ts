/** Jira's rich text (ADF) as a small document model the terminal can lay out. */

import { usDate } from "../dates";
import { clean } from "../text";

export type SpanStyle =
  | "plain"
  | "strong"
  | "em"
  | "code"
  | "link"
  | "strike"
  | "mention"
  | "status"
  | "muted"
  | "error";

/** A run of text with one style. "\n" inside a span is a line break. */
export interface Span {
  text: string;
  style: SpanStyle;
}

export type Tone = "quote" | "info" | "note" | "success" | "warning" | "error";

export type DocBlock =
  /** A paragraph or list item. `marker` is the bullet, number or checkbox;
   * `keep` holds the next block right below, without a blank line. */
  | { kind: "text"; spans: Span[]; indent?: number; marker?: string; keep?: boolean }
  | { kind: "heading"; spans: Span[]; level: number }
  | { kind: "code"; lines: string[] }
  /** A quote or info panel, drawn with a colored bar. */
  | { kind: "box"; tone: Tone; blocks: DocBlock[] }
  /** Rows of cells; each cell is spans, with "\n" between its paragraphs. */
  | { kind: "table"; rows: Span[][][]; header: boolean }
  | { kind: "rule" }
  /** Preformatted text, shown line by line without reflowing. */
  | { kind: "pre"; text: string };

export const textBlock = (text: string, style: SpanStyle = "plain", extra: Partial<DocBlock> = {}): DocBlock =>
  ({ kind: "text", spans: [{ text, style }], ...extra }) as DocBlock;

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);
const contentOf = (node: Node): unknown[] => (Array.isArray(node.content) ? node.content : []);
const attrsOf = (node: Node): Node => (isNode(node.attrs) ? node.attrs : {});
const str = (value: unknown): string => (typeof value === "string" ? clean(value) : "");

/** Marks in priority order: a bold link reads as a link. */
const MARKS: [string, SpanStyle][] = [
  ["code", "code"],
  ["link", "link"],
  ["strong", "strong"],
  ["em", "em"],
  ["strike", "strike"],
];

const TONES: Record<string, Tone> = {
  info: "info",
  note: "note",
  success: "success",
  warning: "warning",
  error: "error",
};

function inline(node: unknown): Span[] {
  if (!isNode(node)) return [];
  const attrs = attrsOf(node);
  switch (node.type) {
    case "text": {
      // Code blocks keep their line breaks; other controls are still removed.
      const text = typeof node.text === "string" ? clean(node.text, true) : "";
      const marks = (Array.isArray(node.marks) ? node.marks : []).filter(isNode);
      const kinds = new Set(marks.map((mark) => mark.type));
      const style = MARKS.find(([mark]) => kinds.has(mark))?.[1] ?? "plain";
      const link = marks.find((mark) => mark.type === "link");
      const url = link ? str(attrsOf(link).href) : "";
      return url && url !== text
        ? [
            { text, style },
            { text: ` (${url})`, style: "muted" },
          ]
        : [{ text, style }];
    }
    case "hardBreak":
      return [{ text: "\n", style: "plain" }];
    case "mention":
      return [{ text: str(attrs.text) || "@someone", style: "mention" }];
    case "emoji":
      return [{ text: str(attrs.text) || str(attrs.shortName), style: "plain" }];
    case "status":
      return [{ text: ` ${str(attrs.text).toUpperCase()} `, style: "status" }];
    case "date": {
      const ms = Number(attrs.timestamp);
      return Number.isFinite(ms) ? [{ text: usDate(new Date(ms).toISOString()), style: "plain" }] : [];
    }
    case "inlineCard":
      return [{ text: str(attrs.url), style: "link" }];
    case "media":
    case "mediaInline":
      return [{ text: attrs.alt ? `[image: ${str(attrs.alt)}]` : "[attachment]", style: "muted" }];
    default:
      return contentOf(node).flatMap(inline);
  }
}

function blocks(nodes: unknown[], indent: number): DocBlock[] {
  return nodes.flatMap((node) => block(node, indent));
}

function block(node: unknown, indent: number): DocBlock[] {
  if (!isNode(node)) return [];
  const attrs = attrsOf(node);
  const spans = () => contentOf(node).flatMap(inline);
  switch (node.type) {
    case "paragraph": {
      const content = spans();
      return content.length ? [{ kind: "text", spans: content, indent }] : [];
    }
    case "heading":
      return [{ kind: "heading", level: Number(attrs.level) || 1, spans: spans() }];
    case "bulletList":
      return list(node, indent, () => "•");
    case "orderedList": {
      const start = Number(attrs.order) || 1;
      return list(node, indent, (n) => `${start + n}.`);
    }
    case "taskList":
    case "decisionList":
      return contentOf(node).flatMap((item) => {
        if (!isNode(item) || (item.type !== "taskItem" && item.type !== "decisionItem")) return block(item, indent + 1);
        const marker = item.type === "decisionItem" ? "◆" : attrsOf(item).state === "DONE" ? "☑" : "☐";
        return [{ kind: "text", spans: contentOf(item).flatMap(inline), indent, marker }];
      });
    case "codeBlock":
      return [
        {
          kind: "code",
          lines: spans()
            .map((span) => span.text)
            .join("")
            .split("\n"),
        },
      ];
    case "blockquote":
      return [{ kind: "box", tone: "quote", blocks: blocks(contentOf(node), 0) }];
    case "panel":
      return [{ kind: "box", tone: TONES[str(attrs.panelType)] ?? "info", blocks: blocks(contentOf(node), 0) }];
    case "rule":
      return [{ kind: "rule" }];
    case "table":
      return [table(node)];
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return [{ kind: "text", spans: node.type === "media" ? inline(node) : spans(), indent }];
    case "expand":
    case "nestedExpand":
      return [
        { kind: "text", spans: [{ text: `▸ ${str(attrs.title) || "Details"}`, style: "strong" }], indent, keep: true },
        ...blocks(contentOf(node), indent + 1),
      ];
    case "blockCard":
    case "embedCard":
      return [{ kind: "text", spans: [{ text: str(attrs.url), style: "link" }], indent }];
    default:
      // Layout columns, extensions and anything newer: keep their content.
      return blocks(contentOf(node), indent);
  }
}

/** List items: the first paragraph carries the marker, the rest indent under it. */
function list(node: Node, indent: number, marker: (n: number) => string): DocBlock[] {
  return contentOf(node).flatMap((item, n) => {
    const inner = isNode(item) ? blocks(contentOf(item), indent + 1) : [];
    const first = inner[0];
    if (first?.kind === "text" && first.marker === undefined) inner[0] = { ...first, indent, marker: marker(n) };
    else inner.unshift({ kind: "text", spans: [], indent, marker: marker(n) });
    return inner;
  });
}

function table(node: Node): DocBlock {
  const rows = contentOf(node).filter(isNode);
  const cells = (row: Node) => contentOf(row).filter(isNode);
  return {
    kind: "table",
    header: rows.length > 1 && cells(rows[0] ?? {}).every((cell) => cell.type === "tableHeader"),
    rows: rows.map((row) => cells(row).map((cell) => cellSpans(blocks(contentOf(cell), 0)))),
  };
}

/** A table cell's blocks as spans, one line per paragraph or list item. */
function cellSpans(content: DocBlock[]): Span[] {
  return content.flatMap((item, n) => {
    const breakBefore: Span[] = n > 0 ? [{ text: "\n", style: "plain" }] : [];
    if (item.kind === "text" || item.kind === "heading") {
      const marker: Span[] = item.kind === "text" && item.marker ? [{ text: `${item.marker} `, style: "plain" }] : [];
      return [...breakBefore, ...marker, ...item.spans];
    }
    if (item.kind === "code") return [...breakBefore, { text: item.lines.join("\n"), style: "code" }];
    if (item.kind === "box") return [...breakBefore, ...cellSpans(item.blocks)];
    return [];
  });
}

/** Rich text from a Jira field: an ADF document, or plain text from old issues. */
export function toDoc(value: unknown): DocBlock[] {
  if (typeof value === "string") return value.trim() ? [textBlock(clean(value, true))] : [];
  return isNode(value) ? blocks(contentOf(value), 0) : [];
}

/** The document as plain text, for one-line previews. */
export function plainText(doc: DocBlock[]): string {
  return doc.map(blockText).filter(Boolean).join("\n");
}

function blockText(item: DocBlock): string {
  switch (item.kind) {
    case "text":
    case "heading":
      return (item.kind === "text" && item.marker ? `${item.marker} ` : "") + item.spans.map((s) => s.text).join("");
    case "code":
      return item.lines.join("\n");
    case "box":
      return plainText(item.blocks);
    case "table":
      return item.rows.map((row) => row.map((cell) => cell.map((s) => s.text).join("")).join(" | ")).join("\n");
    case "pre":
      return item.text;
    case "rule":
      return "";
  }
}

/** Whether an ADF document @-mentions this account. */
export function mentions(node: unknown, account: string): boolean {
  if (!account) return false;
  if (Array.isArray(node)) return node.some((child) => mentions(child, account));
  if (!isNode(node)) return false;
  if (node.type === "mention" && isNode(node.attrs)) return node.attrs.id === account;
  return mentions(node.content, account);
}
