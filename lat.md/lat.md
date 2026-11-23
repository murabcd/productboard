# productboard Knowledge Graph

productboard is a local read-only terminal workspace for product management. The
[launcher](../bin/productboard) runs [[src/main.ts]] with Bun. The entry point connects
local credentials, the Jira client, workspace state, and the terminal UI.

The `--version` flag prints `productboard v<version>` using the version from
[package.json](../package.json) without opening the terminal UI or reading credentials.

The [Homebrew tap](https://github.com/murabcd/homebrew-tap) installs a tagged
release with the launcher, a private Bun runtime, and locked production
dependencies. It installs Node.js for Agent.

The `upgrade [target]` command (alias `update`) delegates to [[src/upgrade.ts#upgrade]].
It follows OpenCode's method detection, version comparison, spinner, and result flow
using Clack. It detects Homebrew from the resolved source location; `--method brew`
(`-m brew`) explicitly selects Homebrew even from a source checkout. It refreshes
metadata before reading and validating the formula's available version, skips an
already installed release, and upgrades `murabcd/tap/productboard` otherwise.
Homebrew revisions count as upgrades. An explicit current version skips the lookup;
other targets must match the formula's available version. Captured command failures
show sanitized details, the command and retry instructions with a nonzero exit code.
These commands run without opening the dashboard or loading Jira credentials.

- [[jira-api]] covers authentication, the read boundary, and issue queries.
- [[terminal-workspace]] covers refresh, interaction, and rendering ownership.

Update the graph when an implementation boundary or behavior contract changes.
[Konsistent](../konsistent.json) checks the test runner and the OpenTUI import
boundary. Tests verify runtime behavior.
