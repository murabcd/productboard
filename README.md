# Jira

A read-only Jira workspace for product management, in the terminal. Built with
TypeScript, [Bun](https://bun.sh) and [OpenTUI](https://github.com/sst/opentui);
it talks to the Jira Cloud REST API with your API token.

## Setup

```sh
bun install
jira --login   # site, email and an API token; the token is saved to macOS Keychain
jira --check   # confirm access without opening the dashboard
jira
```

Create the token at <https://id.atlassian.com/manage-profile/security/api-tokens>.
Use **Create API token** (not the scoped option: scoped tokens only work
through api.atlassian.com, and the dashboard talks to your site directly).
The dashboard only reads, whatever the token allows. Tokens last up to a year;
run `jira --login` again when Jira says it was rejected. Your site, email and last board are kept in
`~/.config/jira-dashboard/config.json`; the token is only in Keychain.

## Views

| Key | View |
| --- | --- |
| `1` | Sprints: choose a board, then an active, planned or closed sprint |
| `2` | All tasks: everyone's issues across accessible projects |
| `3` | Assigned: tasks assigned to you |
| `4` | Created: tasks you created, regardless of who owns them now |
| `5` | Today: what needs attention across active sprints (see below) |
| `6` | Mentions: comments that @-mention you, newest first |
| `7` | Search: issues anywhere in Jira that match your words, or one issue key |

## Keys

| Key | Action |
| --- | --- |
| `b` / `s` | Choose board / sprint (`Tab` in the sprint picker: active, future, closed, all) |
| `p` | Filter by project, or return to All projects |
| `a` | Filter by a person in the loaded issues, All people, or Unassigned |
| `d` | Cycle all / open / done statuses |
| `g` | Group by Jira status or assignee |
| `n` | Load the next 200 issues |
| `/` | Filter the loaded tasks by title, key, status, project key or assignee |
| `f` | Find in all of Jira: words in summaries, descriptions and comments, or an issue key like `EX-123`; `Esc` clears it for a new search |
| `↑/↓`, `j/k`, `Home/End`, `PgUp/PgDn` | Move the selection |
| `Enter` / `v` | Read details and comments |
| `i` | In details: choose an attachment; images preview in the terminal (`←/→` flip, `o` open in Helium), other files open in Helium |
| `t` | Read the selected sprint's goal and dates |
| `o` / `y` | Open in Helium / copy the issue URL |
| `r` | Refresh, or retry what failed |
| `?` / `q` / `Esc` | Help / quit / close or clear |
| Mouse | Click a tab or issue (click again to open); the wheel scrolls lists and details. Hold Shift (or Option) while dragging to select text |

## Behavior

- Project, person and status filters run on Jira and apply across views.
  Assigned always targets you; choosing another person there switches to All
  tasks. Created uses Jira's creator, not the editable reporter field.
- Today groups what needs attention, most urgent first. Each issue appears once,
  in the first section that fits, with the reason in the side column:
  **Blocked** (a status with "Blocked" in its name, flagged as an impediment, or
  blocked by an issue that is still open), **Stuck** (in progress with no update
  for 5+ days, oldest first), **Needs an owner** (unassigned), **Overdue** (past
  the due date) — all in active sprints — then **Mentioned you** (since
  yesterday), **Your issues, changed since yesterday** (created or reported by
  you), **Assigned to you** (still open) and **Forgotten in active sprints**
  (untouched for 30+ days, usually a sprint nobody closed). The project filter
  applies.
- Lists load the 200 most recently updated matching issues; counts, groups and
  the `/` filter cover the loaded set. `f` searches Jira itself, with the
  project, person and status filters applied.
- Boards and sprints load in the background and never hold up the list on
  screen.
- Lists refresh every 60 seconds. Switching views loads the new view at once.
  A failed refresh keeps the previous list; old responses never appear under a
  new view.
- Failed, stalled (8 seconds) or rate-limited requests retry after 1, 3 and 6
  seconds (or Jira's `Retry-After`); boards and sprints that still fail retry every minute.
- Jira search cannot find @-mentions, so Mentions reads the comments returned
  with issues updated in the last 14 days, and fetches full threads only where
  Jira returned part of one.
- Image previews use Kitty graphics where the terminal supports it (Ghostty,
  Kitty), Sixel where available, and colored blocks elsewhere. Images up to
  20 MB are downloaded through Jira; the token is never sent to Jira's media
  service.
- All Jira calls are reads. Remote text is stripped of terminal control
  characters before display.

## Development

```sh
bun run check             # run all validation and tests
bun run check:lat         # validate the knowledge graph
bun run check:konsistent  # check cross-file conventions
bun test                  # unit tests
bun run typecheck         # tsc --noEmit
bun run lint              # Biome lint, format and import order
bun run format            # apply Biome's formatting and safe fixes
```

The [knowledge graph](lat.md/lat.md) describes runtime boundaries and links to
their implementation. [Konsistent](konsistent.json) checks the test runner and
the OpenTUI import boundary.
