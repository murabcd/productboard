import type { Turn } from "../agent/chat";
import { choiceLabel } from "../agent/models";
import { type Line, layout, wrapSpans } from "./document";
import type { AgentLayout } from "./layout";
import { markdownBlocks } from "./markdown";

type TranscriptRow = { kind: "prompt" | "answer" | "plain"; line: Line };

const GAP: TranscriptRow = { kind: "plain", line: [] };
const PROMPT_EDGE: TranscriptRow = { kind: "prompt", line: [] };

const cache = new WeakMap<
  Turn,
  {
    room: number;
    answer: string;
    finished: Turn["finished"];
    interrupted: Turn["interrupted"];
    rows: TranscriptRow[];
  }
>();

function turnRows(turn: Turn, room: number): TranscriptRow[] {
  const { answer, finished, interrupted } = turn;
  const previous = cache.get(turn);
  if (
    previous &&
    previous.room === room &&
    previous.answer === answer &&
    previous.finished === finished &&
    previous.interrupted === interrupted
  ) {
    return previous.rows;
  }
  const rows: TranscriptRow[] = [
    PROMPT_EDGE,
    ...wrapSpans([{ text: turn.displayPrompt, style: "plain" }], room - 5).map(
      (line): TranscriptRow => ({ kind: "prompt", line }),
    ),
    PROMPT_EDGE,
    GAP,
    ...layout(markdownBlocks(answer), room - 3).map((line): TranscriptRow => ({ kind: "answer", line })),
  ];
  if (finished !== undefined) {
    const details = [choiceLabel(turn.choice), duration(finished - turn.started)];
    if (interrupted) details.push("interrupted");
    rows.push(GAP, { kind: "plain", line: [{ text: details.join(" · "), style: "muted" }] });
  }
  rows.push(GAP);
  cache.set(turn, { room, answer, finished, interrupted, rows });
  return rows;
}

function duration(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function transcriptWindow(
  turns: readonly Turn[],
  { room, capacity }: AgentLayout["transcript"],
  fromBottom: number,
  delta = 0,
) {
  const lines = turns.flatMap((turn) => turnRows(turn, room));
  const maximum = Math.max(0, lines.length - capacity);
  const scroll = Math.max(0, Math.min(maximum, Math.min(fromBottom, maximum) + delta));
  const end = lines.length - scroll;
  return { rows: lines.slice(Math.max(0, end - capacity), end), scroll };
}
