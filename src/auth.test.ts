import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("model picks persist across launches, keep five distinct provider and model pairs, and ignore reasoning changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "productboard-model-history-"));
  try {
    const config = join(directory, ".config", "productboard");
    await mkdir(config, { recursive: true });
    await writeFile(
      join(config, "config.json"),
      JSON.stringify({ site: "example.atlassian.net", email: "test@example.com" }),
    );
    const run = (script: string) =>
      Bun.spawnSync([process.execPath, "-e", script], {
        cwd: join(import.meta.dir, ".."),
        env: { HOME: directory },
      });
    const save = run(`
      import { rememberAgentChoice } from "./src/auth";
      const choose = (provider, model) => rememberAgentChoice({ provider, model, reasoning: "medium" }, "model");
      for (let i = 0; i < 6; i++) choose("openai", "model-" + i);
      choose("openai", "model-3");
      choose("anthropic", "model-3");
      rememberAgentChoice({ provider: "openai", model: "model-4", reasoning: "high" }, "reasoning");
    `);
    expect(save.stderr.toString()).toBe("");
    expect(save.exitCode).toBe(0);
    const load = run(`
      import { agentChoice, recentAgentModels } from "./src/auth";
      console.log(JSON.stringify({ active: agentChoice(), recent: recentAgentModels() }));
    `);
    expect(load.exitCode).toBe(0);
    expect(JSON.parse(load.stdout.toString())).toEqual({
      active: { provider: "openai", model: "model-4", reasoning: "high" },
      recent: [
        { provider: "anthropic", model: "model-3" },
        { provider: "openai", model: "model-3" },
        { provider: "openai", model: "model-5" },
        { provider: "openai", model: "model-4" },
        { provider: "openai", model: "model-2" },
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
