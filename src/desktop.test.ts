import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("links use the system default browser and preserve the URL as one argument", async () => {
  const directory = await mkdtemp(join(tmpdir(), "productboard-browser-"));
  try {
    const output = join(directory, "arguments.json");
    await writeFile(
      join(directory, "open"),
      `#!${process.execPath}\nawait Bun.write(process.env.OPENER_ARGUMENTS, JSON.stringify(process.argv.slice(2)));\n`,
      { mode: 0o700 },
    );
    const result = Bun.spawnSync(
      [process.execPath, "-e", 'import { desktop } from "./src/desktop"; await desktop.open(process.env.TEST_URL);'],
      {
        cwd: join(import.meta.dir, ".."),
        env: {
          PATH: `${directory}:/usr/bin:/bin`,
          OPENER_ARGUMENTS: output,
          TEST_URL: "https://other-team.atlassian.net/browse/TEAM-42?text=two words&x=1",
        },
      },
    );
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual([
      "https://other-team.atlassian.net/browse/TEAM-42?text=two words&x=1",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
