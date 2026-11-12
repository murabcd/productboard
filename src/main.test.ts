import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version as packageVersion } from "../package.json";

test("the installed productboard launcher finds Bun on PATH", async () => {
  const directory = await mkdtemp(join(tmpdir(), "productboard-launcher-"));
  try {
    const launcher = join(directory, "productboard");
    await symlink(join(import.meta.dir, "..", "bin", "productboard"), launcher);
    await symlink(process.execPath, join(directory, "bun"));

    const options = {
      cwd: directory,
      env: { HOME: directory, PATH: `${directory}:/usr/bin:/bin` },
    };
    const help = Bun.spawnSync([launcher, "--help"], options);
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toStartWith("Usage: productboard ");
    expect(help.stdout.toString()).toContain("productboard --version");

    const version = Bun.spawnSync([launcher, "--version"], options);
    expect(version.exitCode).toBe(0);
    expect(version.stdout.toString()).toBe(`${packageVersion}\n`);
    expect(version.stderr.toString()).toBe("");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
