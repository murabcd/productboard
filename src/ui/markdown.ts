/** Agent replies are Markdown; as document blocks they lay out like Jira text. */

import { lexer, type MarkedToken, type Token, type Tokens } from "marked";
import type { DocBlock, Span, SpanStyle } from "../jira/adf";
import { clean } from "../text";

/** Token types marked defines; anything else is an extension, kept as text. */
const MARKED_TYPES = new Set<string>([
  "blockquote",
  "br",
  "checkbox",
  "code",
  "codespan",
  "def",
  "del",
  "em",
  "escape",
  "heading",
  "hr",
  "html",
  "image",
  "link",
  "list",
  "list_item",
  "paragraph",
  "space",
  "strong",
  "table",
  "tag",
  "text",
]);
const known = (token: Token): token is MarkedToken => MARKED_TYPES.has(token.type);

/** Markdown escapes entities in code; the terminal shows the characters. */
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const decodeEntities = (text: string): string =>
  clean(text.replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e));

function spans(tokens: Token[], style: SpanStyle = "plain"): Span[] {
  return tokens.flatMap((token): Span[] => {
    if (!known(token)) return [{ text: clean(token.raw), style }];
    switch (token.type) {
      case "strong":
        return spans(token.tokens, "strong");
      case "em":
        return spans(token.tokens, style === "plain" ? "em" : style);
      case "del":
        return spans(token.tokens, "strike");
      case "link":
        return spans(token.tokens, "link");
      case "codespan":
        return [{ text: decodeEntities(token.text), style: "code" }];
      case "br":
        return [{ text: "\n", style }];
      case "text":
        return token.tokens ? spans(token.tokens, style) : [{ text: decodeEntities(token.text), style }];
      case "escape":
        return [{ text: token.text, style }];
      default:
        return [{ text: clean(token.raw), style }];
    }
  });
}

/** A list item: its first paragraph carries the marker, the rest indent under it. */
function listItem(item: Tokens.ListItem, marker: string, indent: number): DocBlock[] {
  const inner = blocks(item.tokens, indent + 1);
  const first = inner[0];
  if (first?.kind === "text" && first.marker === undefined) inner[0] = { ...first, indent, marker };
  else inner.unshift({ kind: "text", spans: [], indent, marker });
  return inner;
}

function blocks(tokens: Token[], indent: number): DocBlock[] {
  return tokens.flatMap((token): DocBlock[] => {
    if (!known(token)) return [{ kind: "text", spans: [{ text: clean(token.raw), style: "plain" }], indent }];
    switch (token.type) {
      case "heading":
        return [{ kind: "heading", level: token.depth, spans: spans(token.tokens) }];
      case "paragraph":
        return [{ kind: "text", spans: spans(token.tokens), indent }];
      // Tight list items hold text tokens directly rather than paragraphs.
      case "text":
        return [{ kind: "text", spans: spans(token.tokens ?? [token]), indent }];
      case "list": {
        const start = typeof token.start === "number" ? token.start : 1;
        return token.items.flatMap((item, n) => listItem(item, token.ordered ? `${start + n}.` : "•", indent));
      }
      case "code":
        return [{ kind: "code", lines: clean(token.text, true).split("\n") }];
      case "blockquote":
        return [{ kind: "box", tone: "quote", blocks: blocks(token.tokens, 0) }];
      case "hr":
        return [{ kind: "rule" }];
      case "table":
        return [
          {
            kind: "table",
            header: true,
            rows: [token.header, ...token.rows].map((row) => row.map((cell) => spans(cell.tokens))),
          },
        ];
      case "html":
        return [{ kind: "text", spans: [{ text: clean(token.text), style: "plain" }], indent }];
      default:
        return [];
    }
  });
}

export const markdownBlocks = (markdown: string): DocBlock[] => blocks(lexer(markdown), 0);
