<p align="center">
  <img alt="Productboard showing Team focus and an issue peek with fictional Jira data" src="./preview/productboard.png" width="760">
</p>

<h1 align="center">productboard</h1>

<p align="center">
  Browse team issues, track your work, and search Jira Cloud from your terminal.
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
bun run start
```

On first launch, **Connect Jira** asks for your Jira Cloud site, Atlassian
account email, and an [API token without scopes](https://id.atlassian.com/manage-profile/security/api-tokens).
Press `Ctrl+O` on the token prompt to open Atlassian's token page. Productboard
checks your sign-in before saving the token to macOS Keychain.

Next, choose **OpenAI** or **Anthropic** and paste a provider API key, or select
**Skip for now** to open Inbox with Jira only.

To run it as `board` from anywhere, link the launcher from the project directory.
Make sure `~/.local/bin` is on your `PATH`.

```bash
mkdir -p ~/.local/bin
ln -s "$PWD/bin/board" ~/.local/bin/board
```

Run `board --login` to update your Jira sign-in or `board --check` to verify
saved access without opening the dashboard.

## Features

- Browse **All issues** and filter by project, assignee, or status.
- Use **Filter → Sprint** to narrow issue lists to one sprint, and **Any sprint**
  to clear the selection. Use **Sprint board** to switch which board supplies the
  sprint choices.
- Find issues assigned to you or created by you, and search across Jira.
- See blockers, overdue issues, and mentions in one place.
- Read comments and preview image attachments in the terminal.
  Open issue peek with `Space` and scroll it with `Shift+↑` or `Shift+↓`.
- Ask Agent about issues across Jira from its page in the sidebar.

The dashboard opens in Inbox. Press `1` for Search, `2` for Agent,
`3` for Inbox, `4` for My issues, `5` for Team focus, or `6` for All issues.

To switch themes, press `Ctrl+K`, choose **Change theme**, then select **Vercel
Light**, **Vercel Dark**, or **Default**. The choice is saved for the next
launch. The Vercel themes use the [Geist Terminal palettes](https://vercel.com/geist/terminal).

## Agent

Install Node.js 24 or newer for the local [Eve](https://github.com/vercel/eve) runtime.
If you skipped Agent during setup, press `Ctrl+K` and choose **Connect Agent**,
or run `board --agent-login`. Choose a provider, open its key page with
`Ctrl+O`, and paste the key into the hidden field. Productboard stores it in
macOS Keychain. An existing provider API key in your shell works too.

Open `board` and select **Agent** in the sidebar (or press `2`). Ask about any
project, sprint, or issue you can access in Jira. The message box grows as you type.
`Enter` sends and `Shift+Enter` (or `Ctrl+J`) adds a line. While Agent answers,
`Esc` interrupts it. Use `Ctrl+N` to start a chat, `Ctrl+↑` / `Ctrl+↓` to
switch between chats, and `Ctrl+O` to open an issue Agent
mentioned.

Drop an image file into the Agent composer or paste its local path. Images
and long or multiline pastes appear inline as numbered labels. Press
Backspace after a label to remove it. You can attach up to four PNG, JPEG, GIF,
or WebP files, up to 3 MB each and 6 MB total.

Type `@` in the composer to search tasks across Jira and sprints on the current
board. Select a result to insert its reference at the cursor. Backspace removes
the reference. A sprint scopes the next message, and task references give Agent
the issue keys to look up.

Agent sends your prompt and attached images to your provider when you press
Enter. It searches Jira when the question needs issue data. Each search shares
up to 50 matching issue summaries with
current fields such as status, assignee, and priority. Its answers can link back
to Jira issues in the terminal. Productboard keeps chat history for the current
run. Reattach images if you switch models or reasoning levels and want to refer
to them again.

Choose Anthropic during setup or set `PRODUCTBOARD_AGENT_PROVIDER=anthropic`
with `ANTHROPIC_API_KEY` in your shell.
Agent uses `gpt-6-luna` with OpenAI and `claude-sonnet-5-5` with Anthropic. To
switch, click the model button on the Agent page (or **Select Agent model** in
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
