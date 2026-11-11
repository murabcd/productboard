# productboard Knowledge Graph

productboard is a local read-only terminal workspace for product management. The
[launcher](../bin/productboard) runs [[src/main.ts]] with Bun. The entry point connects
local credentials, the Jira client, workspace state, and the terminal UI.

The [Homebrew tap](https://github.com/murabcd/homebrew-tap) installs a tagged
release with the launcher, a private Bun runtime, and locked production
dependencies. It installs Node.js for Agent.

- [[jira-api]] covers authentication, the read boundary, and issue queries.
- [[terminal-workspace]] covers refresh, interaction, and rendering ownership.

Update the graph when an implementation boundary or behavior contract changes.
[Konsistent](../konsistent.json) checks the test runner and the OpenTUI import
boundary. Tests verify runtime behavior.
