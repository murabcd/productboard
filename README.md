<p align="center">
  <img alt="productboard showing a fictional storefront sprint grouped by assignee" src="./preview/productboard-sprint.png" width="760">
</p>

<h1 align="center">productboard</h1>

<p align="center">
  Browse team sprints, track your issues, and search Jira Cloud from your terminal.
</p>

<p align="center">
  <a href="#installation">Installation</a> |
  <a href="#features">Features</a> |
  <a href="#agent">Agent</a> |
  <a href="#built-with">Built with</a> |
  <a href="#development">Development</a>
</p>

---

## Installation

Run from the project directory on macOS with [Bun](https://bun.sh) installed.

```bash
bun install
bun run start --login
bun run start
```

Sign in with your Jira Cloud site, Atlassian account email, and an [unscoped API token](https://id.atlassian.com/manage-profile/security/api-tokens).
The dashboard only reads Jira data and stores the token in macOS Keychain.

To run it as `board` from anywhere, link the launcher from the project directory.
Make sure `~/.local/bin` is on your `PATH`.

```bash
mkdir -p ~/.local/bin
ln -s "$PWD/bin/board" ~/.local/bin/board
```

## Features

- Browse team sprints and filter by project, assignee, or status.
- Find issues assigned to you or created by you, and search across Jira.
- See blockers, overdue issues, and mentions in one place.
- Read comments and preview image attachments in the terminal.
- Ask Agent about a sprint from its page in the sidebar.

Press `1` for Search, `2` for Inbox, `3` for My issues, `4` for Agent,
`5` for Team focus, `6` for Sprints, or `7` for All issues.

To switch themes, press `Ctrl+K`, choose **Change theme**, then select **Vercel
Light**, **Vercel Dark**, or **Default**. The choice is saved for the next
launch. The Vercel themes use the [Geist Terminal palettes](https://vercel.com/geist/terminal).

## Agent

Install Node.js 24 or newer for the local [Eve](https://github.com/vercel/eve) runtime.
In Rex, run `board --agent-login` once to save your OpenAI API key to macOS
Keychain. An existing `OPENAI_API_KEY` in your shell works too.

Open `board`, choose a sprint, then select **Agent** in the sidebar (or press
`4`). The message box grows as you type:
`Enter` sends and `Shift+Enter` (or `Ctrl+J`) adds a line. While Agent answers,
`Esc` interrupts it. Use `Ctrl+N` to start a chat, `Ctrl+↑` / `Ctrl+↓` to
switch between chats for that sprint, and `Ctrl+O` to open an issue Agent
mentioned.

Agent sends your prompt and up to 200 issue summaries with status, assignee
and priority to your provider when you ask. Its answers can link back to Jira
issues in the terminal. Productboard keeps chat history for the current run.

For Anthropic, set `PRODUCTBOARD_AGENT_PROVIDER=anthropic` and supply
`ANTHROPIC_API_KEY` or run `board --agent-login` with that provider set.
Agent uses `gpt-6-luna` with OpenAI and `claude-sonnet-5-5` with Anthropic. To
switch, click the model button on the Agent page (or **Choose Agent model** in
`Ctrl+K`): it lists the GPT-6 and Claude 5 models your keys can use, the one in
use first, then asks how much the model should reason (None, Low, Medium, High
or Extra high; Medium unless you change it). Both are remembered and show with
the model, e.g. "GPT-6 Luna · Medium".
`PRODUCTBOARD_AGENT_MODEL` overrides the model at start. Replies show which model
answered.

## Built with

- [TypeScript](https://www.typescriptlang.org) defines the app's types for issues, sprints, and filters.
- [Bun](https://bun.sh) runs the dashboard and its tests and manages dependencies.
- [OpenTUI](https://github.com/sst/opentui) renders the terminal interface and handles keyboard input.
- [Jira Cloud REST APIs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/) provide issues and comments. The [Jira Software REST API](https://developer.atlassian.com/cloud/jira/software/rest/) provides boards and sprints.
- [Zod](https://zod.dev) validates Jira responses and local settings before the app uses them.

## Development

Run `bun run check` for Biome lint and formatting checks, TypeScript type
checks, and Bun tests. It also checks repository structure with Konsistent
and validates the [architecture notes](./lat.md/lat.md) with Lat.
