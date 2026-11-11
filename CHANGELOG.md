# Changelog

## v0.1.0

### Highlights

- **Track work across Jira.** Open Team focus to see blockers, overdue work, and issues that need an owner. Inbox collects mentions, and My issues shows work assigned to you or created by you.
- **Read issues in the terminal.** Press `Space` to peek at an issue beside the list. Read its description and latest comment, or open its details to preview image attachments.
- **Ask Agent about Jira.** [Eve](https://github.com/vercel/eve) powers the Agent tab. Connect OpenAI or Anthropic, type `@` to add an issue or sprint to your message, and open cited issues directly from replies.

### TUI

- Filter issue lists by project, assignee, status, or sprint.
- Press `Ctrl+K` to open the command palette and switch themes, connect Agent, or change models.
- On first launch, sign in with your Jira Cloud site, Atlassian account email, and an API token without scopes. Productboard verifies the token before saving it to macOS Keychain. Agent setup is optional.

### Installation

```sh
brew install murabcd/tap/productboard
productboard
```
