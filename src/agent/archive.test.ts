import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeAgent, settle } from "../testing";
import { ChatArchive } from "./archive";
import { AgentChat } from "./chat";
import { conversation, conversationData } from "./conversation";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function archive() {
  const path = await mkdtemp(join(tmpdir(), "productboard-chats-"));
  directories.push(path);
  return { path, store: await ChatArchive.open(path) };
}

test("saved chats round-trip attachment bytes, drafts and interrupted replies privately", async () => {
  const { path, store } = await archive();
  const thread = conversation();
  thread.name = "Sprint review";
  const image = { filename: "shot.png", mediaType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) };
  const token = { kind: "image", label: "[Image]" } as const;
  thread.draft.restore({ parts: ["Unsent ", token], images: [image] });
  thread.turns.push({
    id: crypto.randomUUID(),
    prompt: "Question",
    displayPrompt: "Question",
    answer: "Partial",
    choice: { provider: "openai", model: "fixture", reasoning: "medium" },
    started: 0,
    state: { kind: "running" },
    parts: ["Question"],
    images: [],
    issues: [],
    tools: [{ id: "search", name: "Search Jira", query: "EX", detail: "Searching…", state: "running" }],
  });
  await store.save(conversationData(thread));
  expect((await stat(join(path, `${thread.id}.json`))).mode & 0o777).toBe(0o600);
  const reopened = new AgentChat(undefined, () => {}, await ChatArchive.open(path));
  expect(reopened.current.name).toBe("Sprint review");
  expect(reopened.current.draft.prepare()?.images[0]?.bytes).toEqual(image.bytes);
  expect(reopened.current.turns[0]).toMatchObject({
    answer: "Partial",
    state: { kind: "interrupted" },
    tools: [{ state: "interrupted" }],
  });
  expect(reopened.recall(-1)).toBe(true);
  expect(reopened.current.draft.parts).toEqual(["Question"]);
  expect(reopened.recall(1)).toBe(true);
  expect(reopened.current.draft.prepare()?.images).toEqual([image]);
  await reopened.dispose();
});

test("a failed file is preserved while other chats load and serialized deletes win over saves", async () => {
  const { path, store } = await archive();
  const thread = conversation();
  await writeFile(join(path, "broken.json"), "broken");
  await store.save(conversationData(thread));
  const reopened = await ChatArchive.open(path);
  expect(reopened.entries).toHaveLength(1);
  expect(reopened.error).toContain("could not be read");
  const saving = store.save(conversationData(thread));
  const deleting = store.remove(thread.id);
  await Promise.all([saving, deleting]);
  expect(await readdir(path)).toEqual(["broken.json"]);
  expect(await readFile(join(path, "broken.json"), "utf8")).toBe("broken");
});

test("clearing a running saved chat keeps neighbors and late output cannot recreate its file", async () => {
  const { path, store } = await archive();
  const chat = new AgentChat(
    fakeAgent(async () => new Promise(() => {})),
    () => {},
    store,
  );
  chat.current.draft.replace(["Neighbor"]);
  chat.start();
  chat.current.draft.replace(["Discard"]);
  const id = chat.current.id;
  const pending = chat.send();
  await settle();
  chat.clear();
  await pending;
  expect(chat.size).toBe(2);
  expect(chat.current.id).not.toBe(id);
  expect(chat.current.turns).toHaveLength(0);
  await chat.dispose();
  expect(await readdir(path)).not.toContain(`${id}.json`);
  expect((await ChatArchive.open(path)).entries).toHaveLength(1);
});
