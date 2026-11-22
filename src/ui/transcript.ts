import type { Turn } from "../agent/chat";
import { choiceLabel } from "../agent/models";
import { type Line, layout, wrapSpans } from "./document";
import type { AgentLayout } from "./layout";
import { markdownBlocks } from "./markdown";

type TranscriptRow = { kind: "prompt" | "answer" | "plain"; line: Line; section: string; row: number };

function sectionRows(kind: TranscriptRow["kind"], section: string, lines: readonly Line[]): TranscriptRow[] {
  return lines.map((line, row) => ({ kind, line, section, row }));
}

const cache = new WeakMap<
  Turn,
  {
    room: number;
    answer: string;
    state: Turn["state"];
    tools: Turn["tools"];
    rows: TranscriptRow[];
  }
>();

function turnRows(turn: Turn, room: number): TranscriptRow[] {
  const { answer, state, tools } = turn;
  const previous = cache.get(turn);
  if (
    previous &&
    previous.room === room &&
    previous.answer === answer &&
    previous.state === state &&
    previous.tools === tools
  ) {
    return previous.rows;
  }
  const rows: TranscriptRow[] = [
    ...sectionRows("prompt", "prompt-top", [[]]),
    ...sectionRows("prompt", "prompt", wrapSpans([{ text: turn.displayPrompt, style: "plain" }], room - 5)),
    ...sectionRows("prompt", "prompt-bottom", [[]]),
    ...sectionRows("plain", "prompt-gap", [[]]),
    ...tools.flatMap((tool) =>
      sectionRows(
        "plain",
        `tool:${tool.id}`,
        wrapSpans(
          [
            {
              text: `${tool.state === "running" ? "◦" : tool.state === "completed" ? "✓" : "!"} ${tool.name}${tool.query ? ` · ${tool.query}` : ""} · ${tool.detail}`,
              style: tool.state === "failed" ? "error" : "muted",
            },
          ],
          room - 3,
        ),
      ),
    ),
    ...sectionRows("plain", "tools-gap", tools.length ? [[]] : []),
    ...sectionRows("answer", "answer", layout(markdownBlocks(answer), room - 3)),
  ];
  if (state.kind !== "running") {
    const details = [choiceLabel(turn.choice), duration(state.finished - turn.started)];
    if (state.kind !== "complete") details.push(state.kind);
    rows.push(...sectionRows("plain", "footer", [[], [{ text: details.join(" · "), style: "muted" }]]));
  }
  if (state.kind === "failed")
    rows.push(...sectionRows("plain", "error", wrapSpans([{ text: state.error, style: "error" }], room - 3)));
  rows.push(...sectionRows("plain", "end", [[]]));
  cache.set(turn, { room, answer, state, tools, rows });
  return rows;
}

function duration(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** Follow the tail until the reader scrolls away, then retain a row in its turn. */
export class TranscriptViewport {
  private anchor?: { turn: Turn; section: string; row: number };
  private latest?: Turn;

  follow(): void {
    this.anchor = undefined;
  }

  window(turns: readonly Turn[], { room, capacity }: AgentLayout["transcript"], delta = 0) {
    if (turns.at(-1) !== this.latest) {
      this.follow();
      this.latest = turns.at(-1);
    }
    const groups = turns.map((turn) => ({ turn, rows: turnRows(turn, room) }));
    const lines = groups.flatMap(({ rows }) => rows);
    const maximum = Math.max(0, lines.length - capacity);
    let top = maximum;
    if (this.anchor) {
      let offset = 0;
      for (const { turn, rows } of groups) {
        if (turn === this.anchor.turn) {
          const section = rows.filter((row) => row.section === this.anchor?.section);
          const row = section[Math.min(this.anchor.row, section.length - 1)];
          top = Math.min(maximum, offset + (row ? rows.indexOf(row) : 0));
          break;
        }
        offset += rows.length;
      }
    }
    top = Math.max(0, Math.min(maximum, top - delta));
    this.follow();
    if (top < maximum) {
      let offset = 0;
      for (const { turn, rows } of groups) {
        if (top < offset + rows.length) {
          const row = rows[top - offset];
          if (row) this.anchor = { turn, section: row.section, row: row.row };
          break;
        }
        offset += rows.length;
      }
    }
    return { rows: lines.slice(top, top + capacity), following: !this.anchor };
  }
}
