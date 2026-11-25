import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { View } from "./jira/query";
import { SavedView } from "./state/views";

test("saved views persist between launches and stay within the signed-in Jira identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "productboard-views-"));
  try {
    const config = join(directory, ".config", "productboard");
    await mkdir(config, { recursive: true });
    const path = join(config, "config.json");
    const preferences = {
      site: "example.atlassian.net",
      email: "test@example.com",
      board: "42",
      theme: "vercel-light",
    };
    await writeFile(path, JSON.stringify(preferences));
    await writeFile(
      join(directory, "security"),
      '#!/bin/sh\nif [ "$1" = "find-generic-password" ]; then printf "test-token\\n"; else cat >/dev/null; fi\n',
      { mode: 0o700 },
    );
    const run = (script: string) => {
      const result = Bun.spawnSync([process.execPath, "-e", script], {
        cwd: join(import.meta.dir, ".."),
        env: { HOME: directory, PATH: `${directory}:/usr/bin:/bin` },
      });
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      return result.stdout.toString().trim();
    };
    const view = {
      id: "team",
      name: "Team overview",
      board: "42",
      personLabel: "All people",
      breakdown: "age",
      scope: { view: View.Team, project: "EX", sprintFilter: 27, assignee: "", status: "open" },
    };
    run(`import { rememberViews } from "./src/auth"; rememberViews(${JSON.stringify([view])});`);
    const read = () =>
      JSON.parse(run('import { readConfig } from "./src/auth"; console.log(JSON.stringify(readConfig()));'));
    const migrated = SavedView.parse(view);
    expect(read()).toEqual({ ...preferences, views: [migrated] });
    const signIn = (site: string, email: string) =>
      run(`import { saveCredentials } from "./src/auth";
      saveCredentials({ site: ${JSON.stringify(site)}, email: ${JSON.stringify(email)}, token: "test-token" });`);
    signIn(preferences.site, preferences.email);
    expect(read().views).toEqual([migrated]);
    const excluded = {
      ...migrated,
      scope: {
        ...migrated.scope,
        assignee: {
          mode: "exclude",
          people: [
            { id: "other", label: "Other person" },
            { id: "unassigned", label: "Unassigned" },
          ],
        },
      },
    };
    run(`import { rememberViews } from "./src/auth"; rememberViews(${JSON.stringify([excluded])});`);
    expect(read().views).toEqual([excluded]);
    signIn(preferences.site, "another@example.com");
    expect(read().views).toBeUndefined();
    await writeFile(path, JSON.stringify({ ...preferences, views: [view] }));
    signIn("other.atlassian.net", preferences.email);
    expect(read().views).toBeUndefined();
    await writeFile(path, JSON.stringify({ ...preferences, views: [{ ...view, breakdown: "invalid" }] }));
    expect(read()).toEqual(preferences);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
