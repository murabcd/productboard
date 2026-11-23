import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../package.json";

const FORMULA = "murabcd/tap/productboard";
const CHECK = [["update"], ["info", "--json=v2", FORMULA]];
const UPGRADE = [...CHECK, ["upgrade", FORMULA]];

test("upgrade and update match OpenCode's method, version, progress, and completion flow", async () => {
  for (const command of ["upgrade", "update"]) {
    const result = await installed([command]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(result.commands).toEqual(UPGRADE);
    expect(result.stdout).toContain("Using method: brew");
    expect(result.stdout).toContain(`From ${version} → 0.1.4`);
    expect(result.stdout).toContain("Upgrade complete");
    expect(result.stdout).toContain("Done");
    expect(result.stdout).not.toContain("raw Homebrew output");
  }
});

test("failed checks and installations stop, show actionable errors, and preserve the exit code", async () => {
  for (const [index, stage] of ["update", "info", "upgrade"].entries()) {
    const result = await installed(["upgrade"], { failure: stage });
    expect(result.exitCode).toBe(7);
    expect(result.commands).toEqual(UPGRADE.slice(0, index + 1));
    expect(result.stdout).toContain("Homebrew test failure");
    expect(result.stdout).toContain(`Command  brew ${UPGRADE[index]?.join(" ")}`);
    expect(result.stdout).toContain("run productboard upgrade again");
    expect(result.stdout).not.toContain("Upgrade complete");
    expect(result.stdout).not.toContain("\u001b]52");
    if (stage === "upgrade") expect(result.stdout).toContain("Upgrade failed");
  }
}, 15_000);

test("help and invalid arguments never run a package manager", async () => {
  const help = await installed(["upgrade", "--help"]);
  expect(help.exitCode).toBe(0);
  expect(help.stdout).toContain("[target]");
  expect(help.stdout).toContain("--method, -m");
  expect(help.commands).toEqual([]);
  for (const args of [["--version"], ["--method", "npm"], ["--method"], ["bad-version"], ["1.0.0", "2.0.0"]]) {
    const invalid = await installed(["upgrade", ...args]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.commands).toEqual([]);
  }
}, 15_000);

test("an explicit current version skips lookup; latest checks fresh metadata before skipping", async () => {
  const explicit = await installed(["upgrade", `v${version}`]);
  expect(explicit.exitCode).toBe(0);
  expect(explicit.commands).toEqual([]);
  expect(explicit.stdout).toContain(`${version} is already installed`);
  const latest = await installed(["upgrade"], { latest: version });
  expect(latest.exitCode).toBe(0);
  expect(latest.commands).toEqual(CHECK);
  expect(latest.stdout).toContain(`${version} is already installed`);
});

test("a newer Homebrew revision upgrades even when the package version is unchanged", async () => {
  const result = await installed(["upgrade"], { latest: version, revision: 1 });
  expect(result.exitCode).toBe(0);
  expect(result.commands).toEqual(UPGRADE);
  expect(result.stdout).toContain(`From ${version} → ${version}_1`);
});

test("explicit methods bypass detection and targets must match the available Homebrew release", async () => {
  for (const flag of ["--method", "-m"]) {
    const result = await installed(["upgrade", "v0.1.4", flag, "brew"], { source: true });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(result.commands).toEqual(UPGRADE);
  }
  const unavailable = await installed(["upgrade", "0.0.1"]);
  expect(unavailable.exitCode).toBe(1);
  expect(unavailable.commands).toEqual(CHECK);
  expect(unavailable.stdout).toContain("Homebrew offers 0.1.4, so it cannot install 0.0.1");
});

test("invalid release metadata cannot trigger an installation", async () => {
  const result = await installed(["upgrade"], { latest: "not-a-version" });
  expect(result.exitCode).toBe(1);
  expect(result.commands).toEqual(CHECK);
  expect(result.stdout).toContain("Could not read the Homebrew release information");
});

test("source upgrades require an explicit method before loading credentials or opening the dashboard", () => {
  const child = Bun.spawnSync([process.execPath, join(import.meta.dir, "main.ts"), "upgrade"], {
    env: { PATH: "/usr/bin:/bin" },
  });
  expect(child.exitCode).toBe(1);
  expect(child.stdout.toString()).toContain("Could not detect the installation method. Pass --method brew");
  expect(child.stderr.toString()).toBe("");
});

interface Scenario {
  latest?: string;
  revision?: number;
  failure?: string;
  source?: boolean;
}

async function installed(args: string[], scenario: Scenario = {}) {
  const directory = await mkdtemp(join(tmpdir(), "productboard-upgrade-"));
  try {
    const root = join(directory, "Cellar", "productboard", version, "libexec");
    const bin = join(directory, "bin");
    const log = join(directory, "brew.jsonl");
    await mkdir(root, { recursive: true });
    await mkdir(bin);
    for (const entry of ["src", "agent", "bin", "package.json", "tsconfig.json"]) {
      await cp(join(import.meta.dir, "..", entry), join(root, entry), { recursive: true });
    }
    await symlink(join(import.meta.dir, "..", "node_modules"), join(root, "node_modules"));
    await symlink(join(root, "bin", "productboard"), join(bin, "productboard"));
    await writeFile(
      join(bin, "brew"),
      `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(process.env.BREW_TEST_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === process.env.BREW_TEST_FAILURE) {
  console.error("\\u001b]52;c;dGVzdA==\\u0007Homebrew test failure");
  process.exit(7);
}
console.log(process.argv[2] === "info"
  ? JSON.stringify({ formulae: [{ versions: { stable: process.env.BREW_TEST_LATEST }, revision: Number(process.env.BREW_TEST_REVISION) }] })
  : "raw Homebrew output");
`,
      { mode: 0o700 },
    );
    const command = scenario.source
      ? [process.execPath, join(import.meta.dir, "main.ts"), ...args]
      : [join(bin, "productboard"), ...args];
    const child = Bun.spawnSync(command, {
      cwd: directory,
      env: {
        HOME: directory,
        // Installed detection must find its own Homebrew executable without PATH.
        PATH: `${scenario.source ? `${bin}:` : ""}/usr/bin:/bin`,
        BUN: process.execPath,
        BREW_TEST_LOG: log,
        BREW_TEST_FAILURE: scenario.failure ?? "",
        BREW_TEST_LATEST: scenario.latest ?? "0.1.4",
        BREW_TEST_REVISION: String(scenario.revision ?? 0),
      },
    });
    const commands = await readFile(log, "utf8").catch(() => "");
    return {
      exitCode: child.exitCode,
      stdout: child.stdout.toString(),
      stderr: child.stderr.toString(),
      commands: commands.trim()
        ? commands
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [],
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
