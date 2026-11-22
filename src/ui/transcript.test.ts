import { expect, test } from "bun:test";
import type { Turn } from "../agent/chat";
import { TranscriptViewport } from "./transcript";

function turn(): Turn {
  return {
    id: crypto.randomUUID(),
    state: { kind: "running", progress: { kind: "answering", attempt: 1 } },
    parts: ["Show issues"],
    prompt: "Show issues",
    displayPrompt: "Show issues",
    answer: `\`\`\`\n${Array.from({ length: 80 }, (_, i) => `Row ${i + 1}`).join("\n")}`,
    choice: { provider: "openai", model: "fixture", reasoning: "medium" },
    started: 0,
    images: [],
    issues: [],
    tools: [],
  };
}

const pane = { room: 70, capacity: 12, top: 0 };
const text = (view: ReturnType<TranscriptViewport["window"]>) =>
  view.rows.map(({ line }) => line.map(({ text }) => text).join(""));

test("streaming follows the tail, holds the reader's rows, and resumes at the bottom", () => {
  const viewport = new TranscriptViewport();
  const reply = turn();
  expect(text(viewport.window([reply], pane)).join("\n")).toContain("Row 80");
  reply.answer += "\nRow 81";
  expect(text(viewport.window([reply], pane)).join("\n")).toContain("Row 81");
  const reading = viewport.window([reply], pane, 25);
  expect(reading.following).toBe(false);
  reply.answer += "\nRow 82\nRow 83";
  expect(text(viewport.window([reply], pane))).toEqual(text(reading));
  reply.state = { kind: "complete", finished: 2000 };
  expect(text(viewport.window([reply], pane))).toEqual(text(reading));
  expect(viewport.window([reply], pane, -1000).following).toBe(true);
  reply.answer += "\nRow 84";
  expect(text(viewport.window([reply], pane)).join("\n")).toContain("Row 84");
});

test("tool growth and resizing keep the same answer row at the top", () => {
  const viewport = new TranscriptViewport();
  const reply = turn();
  viewport.window([reply], pane);
  const reading = viewport.window([reply], pane, 20);
  reply.tools = [{ id: "search", name: "Search Jira", query: "project = EX", state: "running", detail: "Searching…" }];
  expect(text(viewport.window([reply], pane))).toEqual(text(reading));
  expect(text(viewport.window([reply], { ...pane, room: 40, capacity: 6 }))[0]).toBe(text(reading)[0]);
  viewport.follow();
  expect(viewport.window([reply], pane).following).toBe(true);
});

test("a submitted question follows the tail, and separate chats retain separate positions", () => {
  const first = new TranscriptViewport();
  const second = new TranscriptViewport();
  const reply = turn();
  first.window([reply], pane);
  const reading = first.window([reply], pane, 20);
  expect(second.window([turn()], pane).following).toBe(true);
  expect(text(first.window([reply], pane))).toEqual(text(reading));
  expect(first.window([reply, turn()], pane).following).toBe(true);
});
