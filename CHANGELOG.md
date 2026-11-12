# Changelog

Release notes for Productboard, newest first.

## v0.1.1 — 2026-11-12

### Core

#### Improvements

- Print the command name and installed version with `productboard --version`.

### TUI

#### Improvements

- Show issue and sprint suggestions above the Agent composer when typing `@`. Use `Enter` or `Tab` to insert a result.
- Type `/models` in Agent to switch models and choose a reasoning level from the composer.

#### Fixes

- Set the terminal title to **ProductBoard** in setup and the dashboard.

## v0.1.0 — 2026-11-12

### Highlights

- **Track Work Across Jira**: Open **Team focus** to see blockers, overdue work and issues that need an owner. Find mentions in **Inbox** and switch between **Assigned** and **Created** in **My issues**.
- **Peek at Issue Details**: Press `Space` in a wide pane to read the selected issue beside the list. Use `Shift+↑` or `Shift+↓` to scroll through its description and latest comment.
- **Ask Agent About Jira**: Choose **Connect Agent** from `Ctrl+K` and connect **OpenAI** or **Anthropic**. Type `@` to add an issue or sprint to your message.

### Core

#### Improvements

- Run `brew install murabcd/tap/productboard` to install the macOS CLI, then launch it with `productboard`.
- **Connect Jira** checks your Jira Cloud site, Atlassian account email and API token without scopes before saving the token to macOS Keychain. Run `productboard --login` to update your sign-in or `productboard --check` to verify saved access from the terminal.
- **Agent** uses [Eve](https://github.com/vercel/eve) to run locally, search Jira with read-only tools and stream replies from the provider you connect.

### TUI

#### Improvements

- The dashboard opens in **Inbox** with your Jira mentions. **My issues** shows work assigned to you or created by you, and **Team focus** groups blockers, overdue work and issues that need an owner.
- Filter issue lists by project, assignee or status. Choose **Filter → Sprint** to show one sprint or **Any sprint** to clear the selection.
- Press `Space` to open issue peek. In the full issue view, press `i` to preview an image attachment or choose one when there are several.
- In **Connect an integration**, choose **OpenAI** or **Anthropic**, or select **Skip for now** to open **Inbox** with Jira only. In **Agent**, type `@` to find issues and sprints, and press `Ctrl+O` to open a cited issue.
- Press `Ctrl+K` and choose **Change theme** to switch palettes or **Select Agent model** to pick a model and reasoning level.
