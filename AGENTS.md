# Repository Guidelines

Jira is a read-only terminal workspace for product management. It runs locally
with TypeScript, Bun, and OpenTUI and reads directly from Jira Cloud's REST API.

## Knowledge Graph

Start with `lat.md/lat.md` for runtime boundaries and behavior contracts. Use
`[[wiki links]]` between graph sections and to supported source symbols. Start
each section with an overview paragraph. Update the relevant section when a
contract changes and run `bun run check:lat` after graph edits.

## Project Structure & Module Organization

- `bin/jira` is the shell launcher. `src/main.ts` handles CLI flags and wires
  together authentication, the Jira client, workspace state, and the terminal.
- `src/auth.ts` owns credential handling and local preferences.
- `src/jira/http.ts` owns authenticated transport, retries, request priority,
  and attachment downloads. `src/jira/client.ts` owns Jira reads and pagination.
- `src/jira/query.ts` owns view scope, filters, and JQL. `src/jira/today.ts` owns
  Today classification and ordering. `src/jira/parse.ts` and `src/jira/adf.ts`
  turn remote payloads into typed issues, comments, and documents.
- `src/state/workspace.ts` owns list and catalog loading, refresh, and query
  transitions. `src/ui/dashboard.ts` owns interaction state. The frame and
  layout modules calculate what to draw, and `src/ui/screen.ts` adapts that to
  OpenTUI. Use `src/text.ts` for terminal text sanitization and cell widths.

## Core Priorities

1. Keep keyboard navigation responsive while Jira requests are in flight.
2. Keep the last successful list visible during same-scope refreshes and
   failures. Discard late results when the user changes scope. Load boards and
   sprints in the background without delaying issue reads.
3. Preserve the distinction between team-wide views and personal views. All
   tasks and Sprints show team work within the selected scope. Assigned uses
   the assignee and Created uses Jira's creator field. Keep Jira-side filters
   in the query layer and the local text filter scoped to loaded rows.

## Maintainability

Keep one implementation for each behavior. Reuse the existing query, transport,
state, and rendering boundaries before adding helpers. Keep API calls out of
rendering and OpenTUI details out of Jira and workspace modules. Update
`README.md` when a command, keybinding, view, or setup step changes.

## Build, Test, and Development Commands

Run `bun install` at the repository root. Use `bun run start` to launch from the
checkout and `jira` for the installed launcher. Use `jira --login` to configure
credentials and `jira --check` to verify live access.

Run `bun run check` for Lat, Konsistent, Biome, TypeScript, and tests. Use
`bun run check:lat`, `bun run check:konsistent`, `bun run lint`,
`bun run typecheck`, or `bun test` for a focused check. Run `bun run format`
when intentionally applying Biome fixes.

## Coding Style & Code Quality

Follow Biome's two-space indentation, 120-character line width, double quotes,
and import ordering. Use top-level imports and type-only imports for types.
Keep TypeScript strict and avoid `any` and unchecked casts. Check installed
dependency types before declaring a substitute. Derive types from the owning
schema or module when possible.

Validate external data at its boundary with named schemas and pass typed domain
values downstream. Keep Jira-specific normalization in the Jira modules.
Reuse the shared JQL builder for quoting and escaping filter values.
Update `konsistent.json` when a repeated structural convention changes and run
`bun run konsistent validate` to check the configuration.

## Testing Guidelines

Colocate `*.test.ts` files with the behavior they cover and use `bun:test`.
Use the existing test fixtures, injected fetcher, and workspace source to test
without Jira credentials. Prioritize request and pagination failures, stale
responses, query scope, terminal input, and document layout. Add a regression
test at the owning boundary when existing tests would miss the failure.

Run the relevant test file during development and `bun run check` before
opening a PR with code changes. For changes that depend on terminal behavior,
exercise the affected flow in Rex. Use `jira --check` to verify authentication
when relevant. Verify the affected data path in the dashboard for live API
changes.

## Commit & Pull Request Guidelines

Keep commits scoped to one change. Use lowercase Conventional Commit subjects
such as `fix: preserve issue selection on refresh`. Describe the behavior
change and checks run in the PR, including any live Jira or terminal coverage.

## Security & Configuration

Keep Jira operations read-only, including JQL search requests that use POST.
Store the API token in macOS Keychain and keep site, email, and board preferences
in the existing local config. Keep tokens out of files, logs, test fixtures,
and terminal output. Send authorization only to the configured Jira site and
follow attachment redirects without forwarding credentials. Sanitize remote
text before rendering it in the terminal.
