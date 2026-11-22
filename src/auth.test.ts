import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("workflow mappings survive same-site sign-in, reset on a different site, and cannot invalidate credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "productboard-workflow-"));
  try {
    const config = join(directory, ".config", "productboard");
    const path = join(config, "config.json");
    await mkdir(config, { recursive: true });
    const workflow = { statuses: { "На проверке": "In review" }, blockedLinkTypes: ["Блокирует"] };
    const preferences = { site: "example.atlassian.net", email: "test@example.com", board: "36", workflow };
    await writeFile(path, JSON.stringify(preferences));
    await writeFile(
      join(directory, "security"),
      '#!/bin/sh\nif [ "$1" = "find-generic-password" ]; then printf "test-token\\n"; else cat >/dev/null; fi\n',
      { mode: 0o700 },
    );
    const result = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
        import { writeFileSync } from "node:fs";
        import { readConfig, saveCredentials, loadCredentials } from "./src/auth";
        const credentials = { site: "example.atlassian.net", email: "test@example.com", token: "test-token" };
        saveCredentials(credentials);
        const sameSite = readConfig();
        saveCredentials({ ...credentials, site: "another-team.atlassian.net" });
        const otherSite = readConfig();
        writeFileSync(process.env.TEST_CONFIG, JSON.stringify({
          ...sameSite, workflow: { statuses: { Custom: "Invalid" } }
        }));
        console.log(JSON.stringify({ sameSite, otherSite, loaded: loadCredentials() }));
      `,
      ],
      {
        cwd: join(import.meta.dir, ".."),
        env: { HOME: directory, PATH: `${directory}:/usr/bin:/bin`, TEST_CONFIG: path },
      },
    );
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      sameSite: preferences,
      otherSite: { site: "another-team.atlassian.net", email: "test@example.com" },
      loaded: { site: preferences.site, email: preferences.email, token: "test-token" },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

test("team mode survives a new process and ignores an invalid saved mode without losing sign-in", async () => {
  const directory = await mkdtemp(join(tmpdir(), "productboard-team-mode-"));
  try {
    const config = join(directory, ".config", "productboard");
    await mkdir(config, { recursive: true });
    const path = join(config, "config.json");
    const preferences = { site: "example.atlassian.net", email: "test@example.com", board: "36" };
    await writeFile(path, JSON.stringify(preferences));
    const run = (script: string) =>
      Bun.spawnSync([process.execPath, "-e", script], {
        cwd: join(import.meta.dir, ".."),
        env: { HOME: directory },
      });
    const save = run('import { rememberTeamMode } from "./src/auth"; rememberTeamMode("attention");');
    expect(save.exitCode).toBe(0);
    const read = () => {
      const result = run('import { readConfig } from "./src/auth"; console.log(JSON.stringify(readConfig()));');
      expect(result.exitCode).toBe(0);
      return JSON.parse(result.stdout.toString());
    };
    expect(read()).toEqual({ ...preferences, teamMode: "attention" });
    await writeFile(path, JSON.stringify({ ...preferences, teamMode: "unknown" }));
    expect(read()).toEqual(preferences);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
