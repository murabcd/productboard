import { expect, test } from "bun:test";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentDraft } from "./draft";

test("an image removed before its read settles cannot publish an error on the replacement draft", async () => {
  const directory = await mkdtemp(join(tmpdir(), "productboard-draft-"));
  try {
    const draft = new AgentDraft();
    const attachment = draft.attachImage(join(directory, "missing.png"), "[Image #1]", (token) => {
      draft.replace([token]);
    });
    expect(draft.loading).toBe(true);
    draft.replace(["replacement"]);
    await attachment;
    expect(draft.error).toBe("");
    expect(draft.prepare()).toMatchObject({ prompt: "replacement", images: [] });
  } finally {
    await rmdir(directory);
  }
});
