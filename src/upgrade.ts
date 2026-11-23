import { realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { intro, log, outro, spinner } from "@clack/prompts";
import { z } from "zod";
import { version as currentVersion } from "../package.json";
import { clean } from "./text";

const FORMULA = "murabcd/tap/productboard";
const HOMEBREW_ROOT = /\/Cellar\/productboard\/[^/]+\/libexec$/;
const ReleaseVersion = z
  .string()
  .trim()
  .regex(/^v?\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/)
  .transform((v) => (v.startsWith("v") ? v.slice(1) : v));
const BrewInfo = z.object({
  formulae: z.tuple([
    z.object({
      versions: z.object({ stable: ReleaseVersion }),
      revision: z.number().int().nonnegative(),
    }),
  ]),
});
const HELP = `Usage: productboard upgrade [target] [--method brew]

Update Productboard to the latest release or select a target version.

  target             Version to install (Homebrew must offer this version)
  --method, -m       Installation method: brew (auto-detected by default)
  --help, -h         Show this help

Alias: productboard update`;

/** OpenCode-style upgrade flow; Homebrew owns release installation. */
export async function upgrade(args: string[]): Promise<number> {
  try {
    const options = parseArgs({
      args,
      allowPositionals: true,
      options: { method: { type: "string", short: "m" }, help: { type: "boolean", short: "h" } },
    });
    if (options.values.help) {
      process.stdout.write(`${HELP}\n`);
      return 0;
    }
    if (options.positionals.length > 1) throw new Error(HELP);
    const input = options.positionals[0];
    const target = input === undefined ? undefined : ReleaseVersion.safeParse(input);
    if (target && !target.success) throw new Error(`Invalid version: ${clean(input ?? "")}`);
    if (options.values.method !== undefined && options.values.method !== "brew") {
      throw new Error("Unsupported installation method. Productboard releases support --method brew.");
    }

    intro("Upgrade");
    // Bun is a separate runtime; detect the installation from Productboard's source.
    const root = await realpath(fileURLToPath(new URL("..", import.meta.url)));
    const installed = HOMEBREW_ROOT.test(root);
    if (!installed && !options.values.method) {
      throw new Error(
        "Could not detect the installation method. Pass --method brew to upgrade the Homebrew installation.",
      );
    }
    log.info("Using method: brew");
    const requested = target?.data;
    if (requested === currentVersion) return skipped(currentVersion);

    const brew = (installed && Bun.which(resolve(root, "../../../../bin/brew"))) || Bun.which("brew");
    if (!brew) throw new Error("Homebrew was not found. Add brew to PATH and run productboard upgrade again.");

    // Refresh before comparing versions so stale tap metadata cannot hide a release.
    await run(brew, ["update"]);
    const output = await run(brew, ["info", "--json=v2", FORMULA]);
    const info = BrewInfo.safeParse(await new Response(output).json().catch(() => undefined));
    if (!info.success) throw new Error("Could not read the Homebrew release information. Try brew update, then retry.");
    const formula = info.data.formulae[0];
    const latest = formula.versions.stable;
    if (requested !== undefined && requested !== latest) {
      throw new Error(
        `Homebrew offers ${latest}, so it cannot install ${requested}. Run productboard upgrade for the latest release.`,
      );
    }
    const keg = `${latest}${formula.revision ? `_${formula.revision}` : ""}`;
    if (latest === currentVersion && (!installed || basename(dirname(root)) === keg)) return skipped(latest);

    log.info(`From ${currentVersion} → ${keg}`);
    const progress = spinner();
    progress.start("Upgrading...");
    try {
      await run(brew, ["upgrade", FORMULA]);
      progress.stop("Upgrade complete");
    } catch (error) {
      progress.error("Upgrade failed");
      throw error;
    }
    outro("Done");
    return 0;
  } catch (error) {
    log.error(clean(stripVTControlCharacters(error instanceof Error ? error.message : String(error)), true));
    return error instanceof HomebrewError ? error.code : 1;
  }
}

function skipped(version: string): number {
  log.warn(`Productboard upgrade skipped: ${version} is already installed`);
  outro("Done");
  return 0;
}

class HomebrewError extends Error {
  constructor(
    readonly code: number,
    command: string[],
    detail: string,
  ) {
    super(
      [
        "Homebrew command failed",
        "",
        detail.trim().split("\n").slice(-12).join("\n").slice(-2000) || `Exited with code ${code}.`,
        "",
        `Command  brew ${command.join(" ")}`,
        "Retry    Fix the error above, then run productboard upgrade again.",
      ].join("\n"),
    );
  }
}

async function run(brew: string, args: string[]): Promise<string> {
  const child = Bun.spawn([brew, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 300_000 });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new HomebrewError(code > 0 ? code : 1, args, stderr || stdout);
  return stdout;
}
