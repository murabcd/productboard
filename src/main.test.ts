import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the installed productboard launcher finds Bun on PATH", async () => {
  const directory = await mkdtemp(join(tmpdir(), "productboard-launcher-"));
  try {
    const launcher = join(directory, "productboard");
    await symlink(join(import.meta.dir, "..", "bin", "productboard"), launcher);
    await symlink(process.execPath, join(directory, "bun"));

    const result = Bun.spawnSync([launcher, "--help"], {
      cwd: directory,
      env: { HOME: directory, PATH: `${directory}:/usr/bin:/bin` },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toStartWith("Usage: productboard ");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
