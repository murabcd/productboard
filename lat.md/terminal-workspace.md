# Terminal Workspace

[[src/state/workspace.ts#Workspace]] owns asynchronous list and catalog state.
It reads typed snapshots through [[jira-api]] and publishes state changes for
the terminal to draw.

## Connection setup

[[src/main.ts]] opens [[src/setup.ts]] on an interactive launch that needs Jira
credentials. [[src/ui/setup.ts]] draws the credential fields and the Agent
provider picker. Agent setup follows Jira and can be skipped.

Jira verifies the token before [[src/auth.ts]] saves it. The command palette's
**Connect Agent** action reuses the provider picker and connects the current
dashboard. The standalone login flags reuse the same prompts. The check flag
uses saved Jira credentials without opening the terminal UI.
If the terminal is too small for setup, the prompt accepts only cancellation
until the form fits again.

## Refresh and scope

The current list stays visible during refresh and on refresh failure. A scope
change cancels the previous read and rejects any late result.

[[src/cache.ts#RecentCache]] retains up to 20 exact issue queries (including page
limit), 20 board sprint lists, and 50 issue details in memory per launch. Entries
are fresh for 60 seconds from successful completion; revisiting does not extend
freshness. Fresh scopes restore immediately without Jira reads. Expired scopes
show their cached rows while one read refreshes them. Only the active issue list
refreshes on a timer, due 60 seconds after its last read. Manual `r` bypasses list
and detail freshness; failures keep successful data and never renew its age.
Least recently used entries are evicted when each cache reaches its limit.

Startup opens Inbox and loads mentions alongside the board catalog.
A scope starts loading as soon as it is ready. Clearing server filters applies
one scope change. Board discovery, project discovery, and the selected board's
sprint catalog publish and retry independently of one another and the issue
list. A failed catalog retains its last successful choices.
The Filter menu uses the selected board's sprint catalog. Its optional sprint
filter carries across issue lists. Changing the sprint board in Filter clears
an active sprint filter and starts the new board’s sprint read immediately.
When no sprint filter is active, the board change leaves the loaded issue
pages and local filter intact. Only the current sprint request can publish
results or schedule a retry.

## Interaction and rendering

[[src/ui/dashboard.ts#Dashboard]] owns keyboard and mouse interactions, issue
selection, and panels. [[src/ui/frame.ts#frame]] computes what to draw, and
[[src/ui/screen.ts#useRenderer]] connects input and drawing to OpenTUI.

[[src/ui/screen.ts#openScreen]] sets the terminal title to `ProductBoard`
for interactive sessions. The CLI restores the terminal on exit.

Dashboard resolves the active input layer from the open views and the pane
size. Rendering and the OpenTUI adapter use that layer for composer focus and
key routing. A connection prompt dims the workspace and takes keyboard and
paste input while it is open. The command palette follows the same activation
path for keys and clicks, so dismissing it returns to the page beneath it. The
minimum-size screen owns its quit shortcut even when Agent was active.

Use [[src/text.ts]] for remote text sanitization, grapheme handling, and cell
widths.

[[src/desktop.ts#desktop]] opens links in the system default browser and copies
text through the macOS clipboard. Setup and dashboard actions share this adapter.
Partial attention snapshots retain their successful rows and show the missing
checks in the footer, with the normal refresh action available to retry.

## Themes

[[src/theme.ts]] defines the built-in palettes. The command palette is the
only entry point for changing themes. [[src/auth.ts]] saves the selected
theme in the local preferences.

[[src/ui/theme.ts]] resolves the palette into semantic colors for the frame,
selection, and Agent composer. Switching themes recolors the existing renderer
and composer while preserving the active page and draft.

## Screen layout

The frame has a top bar, navigation sidebar, page header, body, and footer.
A blank row separates the body from the footer, which shows counts, sync
status, and shortcuts.

[[src/ui/navigation.ts#NAV_GROUPS]] puts one blank row between Search and Agent
and Inbox, My issues, and Team issues. Sidebar icons use Nerd Font glyphs.
[[src/ui/navigation.ts#NAVIGATION]] flattens that order for number keys, Tab,
and the command palette. On narrow panes, the same order appears as tabs
below the title bar.

[[src/ui/header.ts#pageHeader]] supplies the title for the row shared with the
app name and command palette shortcut. [[src/ui/header.ts#drawHeader]] draws
the description and toolbar below, including tabs, filters, and page actions.
Team issues has All issues and Needs attention tabs. [[src/ui/navigation.ts#NavItem]]
owns each page’s tabs; left/right and clicks switch them.
Both team modes preserve server and local text filters. All issues is the initial
team mode; [[src/ui/dashboard.ts#Dashboard]] tracks mode changes from workspace
notifications, including assignee transitions. [[src/auth.ts#rememberTeamMode]]
saves the last choice across launches.
Sidebar, number keys, Tab, and page commands reopen that choice. Team issues
offers Sprint brief when a sprint is selected. Filters follow the mode tabs on
the same toolbar, matching My issues. When the tabs and Filter control cannot
fit beside the actions, tabs wrap onto the row above. Otherwise, one blank row
separates the description from the toolbar.
The Jira query field sits directly below the toolbar. Issue pages without
that field leave one blank row below the toolbar.
Search and picker fields show a muted placeholder with a block cursor at the
start. [[src/ui/search-input.ts#SearchInput]] handles text editing and pasting.
The issue list has one active search field, either the Jira query or the
filter over loaded issues.
The active view or picker handles confirmation, dismissal, and list navigation.
The results area is blank until a Jira query is submitted.

[[src/ui/pickers.ts#PICKERS]] describes every picker in one table: boards,
sprints, filters, models, the command palette and the rest. Each item carries
the action it runs. [[src/ui/picker.ts#Picker]] owns the grouped row window,
highlight, search, and navigation. Catalog refreshes preserve the highlight
by choice value. Keyboard, wheel, and clicks all use that projection, and
the frame draws only the visible rows.

[[src/ui/issue-list.ts#IssueList]] owns the projection for grouping, folded
rows, selected issue identity, and scrolling. Paging uses display rows so
group headings count against the same capacity the frame draws. The frame
uses that projection for the visible rows and issue count. This keeps
selection and viewport changes together across filtering and refresh.

Status groups are workflow stages from [[src/ui/status.ts]]. Rows show
the key, the title, then reason, assignee, sprint and priority columns. A
column is left out when the view or headings already say the same thing.
[[src/ui/dialog.ts#dialogPanel]] centers setup prompts and modal workspace pickers
horizontally across the terminal and places them a quarter of the way down,
moving them up when needed to fit. They share a 60-column width with a
one-column margin on narrow panes. Pickers share search, grouped choices,
the current choice marker, and one-click selection.

[[src/ui/peek.ts#drawPeek]] shows the selected issue beside the list, with a
one-column gap at the right edge of the workspace. The dashboard loads
details outside rendering. [[src/ui/issue-details.ts#IssueDetails]]
shares one read per issue key across Peek and full details. Both views observe
the same result while open. A retry retains the last successful details until
a new read settles. Reopening fresh details uses the bounded cache; expired
details remain visible while reloading. In-flight reads are shared by issue key.

[[src/jira/adf.ts]] converts Jira documents to typed blocks, and
[[src/ui/document.ts]] lays those blocks out for the available terminal width.
In issue details, `i` previews a sole image attachment directly. For other
attachment lists, it opens the picker over the issue details.
[[src/ui/preview.ts#ImagePreviews]] owns image selection and downloads. Returning
to an image reuses its in-flight read or a recent successful result.

## Agent

The Agent page holds conversations about issues across Jira, managed by
[[src/agent/chat.ts#AgentChat]], which also owns connecting and closing the
Agent backend. [[src/ui/agent-panel.ts#AgentPanel]] owns whether Agent is shown
and its keys.

The frame reserves areas that OpenTUI draws itself: the Agent text box and image
previews. Issue citations open the normal detail panel and can
return to the conversation. [[src/ui/transcript.ts#TranscriptViewport]] shares
one viewport between drawing and scrolling. [[src/ui/agent-panel.ts#AgentPanel]]
keeps a viewport per conversation. It follows streamed replies until wheel or
page navigation moves away from the bottom, then anchors the top row to a section
within its turn. Tool growth, completion footers, and composer resizing preserve
that reading position. Reaching the bottom, clicking Jump to latest, Ctrl+End,
or submitting a question resumes following. Page keys move by the visible
rows after the composer has taken its space. Transcript layout is reused
while the turn content and pane width stay the same. These interactions follow
[OpenCode's scrolling behavior](https://github.com/anomalyco/opencode/blob/ee5fe34e136488a1839ac73bcca8321c51a31b75/packages/cli-rs/crates/tui/src/routes/session/scroll.rs),
adapted to this terminal's frame renderer.

Typing `/` in an empty Agent composer offers `/models`, `/effort`, `/new`,
`/clear`, `/copy`, `/chats`, `/rename`, `/delete`, and `/compact` above the text box while the query stays in the draft. Selecting a
command clears its text. `/models` and `/effort` open their corresponding
pickers. `/new` uses the same chat action as Ctrl+N and keeps earlier chats
available.
`/copy` copies the latest nonempty answer through the dashboard's clipboard opener.
`/answers` searches individual prompts and answer previews to copy one reply.
Settled reply footers offer the same copy action and Fork chat. `/fork` selects a
settled reply from the keyboard. [[src/agent/chat.ts#AgentChat]] copies the full
record through that reply into a new saved chat with its own ID, draft and
mutable turn/attachment data. A checkpoint is inherited only if its boundary is
included. Original later turns, draft and live session remain with the source chat.
`/clear` stops any reply and replaces the current chat with an empty one in
the same position. Eve retires its session, so the next message starts fresh.
[[src/ui/dialog.ts#drawComposerMenu]] draws these pickers and `@`
suggestions at the composer's width. Model and reasoning searches receive input
until selection or dismissal while the message draft stays in place.
[[src/agent/models.ts#listModels]] lists GPT-6 and Claude 5 models from each
provider with a key. [[src/agent/chatgpt.ts#chatgptModels]] verifies a local
ChatGPT sign-in and reads the account's model list from Codex. Setup remembers
the selected connection and starts with the account's default model.
[[src/auth.ts#rememberAgentChoice]] saves the five latest
distinct model picks. The picker shows available picks under Recent, followed
by the remaining models newest first under each provider. Search lists matches
by provider. Subscription models appear under OpenAI with a right-aligned
Subscription tag and remain separate picks from their API key counterparts.
The dot marks the active model in any section.
Choosing one, then a reasoning level, restarts the Eve process with both
and saves them. Each turn captures those settings before waiting for Eve. If
another switch overtakes a waiting turn, the question returns to the draft
instead of running with a different model or reasoning level.

[[src/agent/eve.ts#EveAgent]] starts a local Eve subprocess and sends messages
through its authenticated loopback HTTP API. Eve's ACP adapter accepts only
text, while the HTTP client supports image parts and per-turn context. Eve
stages sent images in its local just-bash sandbox.
[[src/agent/draft.ts#AgentDraft]] owns the ordered text and attachments in each
conversation. Image reads settle only while their tokens are in that draft.
[[src/ui/composer.ts#AgentComposer]] maps those parts to OpenTUI extmarks. Pasted local image paths and long or multiline
text appear as numbered inline tokens that can be edited as a unit. Sending
expands pasted text and passes staged images as separate parts. Typing `@` at the
start of a word opens grouped task and sprint suggestions directly above the
focused composer. The text after `@` drives the search, and selecting a result
replaces that text and the trigger with an inline reference. Esc closes the
suggestions and keeps the typed text. [[src/ui/context-picker.ts#ContextPicker]]
owns lookup, result ordering and the selected reference. It cancels pending
searches when the query changes or the picker closes.
[[src/jira/client.ts#JiraClient]] searches across Jira projects and Jira matches
appear before loaded tasks. Sprints come from the current board. Task keys are
passed in the prompt and a sprint scopes the next message.
At the start of the composer, Up recalls sent prompts in the current chat;
at the end, Down moves forward through them and restores the unsent draft.
History retains the original attachment tokens and never replaces an edited
recalled prompt. Multiline cursor navigation and completion menus take precedence.

Eve's Jira search tool calls [[src/agent/jira-search.ts#openJiraSearch]]
over an authenticated loopback connection owned by the dashboard. The tool can
only search Jira and returns at most 50 matches per call. It sends a projection
of the results to the model and emits the issue records through the event stream for
terminal citations. Jira credentials stay in the dashboard. Provider
API keys come from the shell or macOS Keychain. The ChatGPT subscription
uses Eve's model helper, with credentials managed by Codex.
[[src/agent/conversation.ts]] defines the validated conversation record. Prompt
recall derives from its turns, including the original attachments.
[[src/agent/archive.ts#ChatArchive]] saves one private, atomic file per chat under
`~/.local/state/productboard`, partitioned by a hash of the Jira site and email.
Draft changes and streaming output schedule throttled saves; shutdown flushes
remaining records. Running turns reopen as interrupted, preserving partial text.
Invalid files stay on disk and a storage failure is visible in Agent. Clear and
delete retire the session before removing the record; late callbacks cannot save it
again. [[src/ui/chat-pickers.ts]] offers full conversation search, rename and delete.
The dashboard cancels pending work on exit. Sessions,
search access and streaming callbacks belong to the Eve process that created
them.

[[src/agent/eve-stream.ts#EveStream]] uses Eve's installed message reducer to
reconcile text deltas with authoritative completions and project tool calls by
call ID. The terminal shows JQL, running or failed searches, result counts, and
partial-result hints. `/tools` and clickable tool rows open
[[src/ui/agent-tool.ts#toolPanel]], with the full query, requested limit, result
summaries and a partial-result hint. The bridge preserves actionable Jira HTTP
statuses without forwarding response bodies. Tool errors use controlled reasons
for invalid JQL, credentials, permission, throttling and connection failures.
[[src/agent/chat.ts#AgentChat]] preserves failed and
interrupted turns, marks unfinished tools, restores a failed question only into
an empty draft, and rejects callbacks after a turn settles. A replacement Eve
session receives all earlier turns without a fixed turn or character cutoff,
including Jira evidence, sprint references, and images. Existing sessions use
Eve's own history and automatic compaction. `/compact` creates an application
checkpoint with bounded, sequential summary requests through Eve. Each request
gets the prior summary and the next transcript segment; no transcript prefix is
silently dropped. [[src/agent/context.ts]] owns model context selection and
recovery serialization. A successful checkpoint records the last included turn
and retires the live Eve session; replacement sessions receive that summary and
subsequent full turns and images. The full record remains available for reading,
recall, and saved chats, including older image bytes. Failed or cancelled
compaction preserves the earlier checkpoint. Summarization sessions are retired
after every segment and never become visible conversation turns.

[[src/agent/failure.ts]] classifies transport and Eve turn failures into controlled
messages, keeping provider response bodies out of the saved record. Context,
authentication, billing, model and request errors are not automatically retried.
[[src/agent/reply.ts#runReply]] owns callbacks and attempt settlement. Transient
failures before text receive at most one additional attempt, with visible backoff,
bounded Retry-After handling, and cancellation. Failed attempts cannot publish
late callbacks. Partial replies wait for explicit Retry and remain in the record;
the new attempt receives the original prompt and attachments without replacing
an edited draft. Retrying an older turn forks through that turn first. `/retry`
and reply buttons expose the same action; context failures also offer Compact.

[[src/agent/queue.ts#PromptQueue]] owns queued follow-ups and atomic composer edits.
Enter during a reply or compaction snapshots a ready message with its attachments.
Editing replaces a ready item with a placeholder at the same position; the sole
editable content lives in the composer. Enter saves it back in place. Canceling an
edit leaves its text as an unsent draft. The queue never overwrites another draft.
[[src/ui/agent-queue.ts#drawQueue]] shows the first queued messages and exposes edit,
cancel, manage and resume actions. `/queue` reaches every entry from the keyboard.
Layout reserves queue rows and limits the composer height before either can
overlap the transcript or header in a minimum pane.

Successful replies drain ready items in order. Failure, cancellation and an editing
placeholder pause delivery. Reopened queues wait for a user action. Queue state
and editing placeholders share the saved conversation record. Clear/delete retire
the conversation before any drain can continue. [[src/agent/conversation.ts#AgentOperation]]
provides a completion boundary for cancellation, shutdown and Send now. Ctrl+Enter
explicitly interrupts the current operation, waits for settlement and sends the
current draft before other queued messages, retaining the interrupted turn.
This application action is distinct from automatic follow-ups; Eve deliveries use
its explicit queue policy rather than implicit steering. Queue actions and typing
do not steal the paused transcript's reading position.

## Saved views and breakdowns

[[src/state/views.ts#SavedViews]] owns validated local scope records and the active
breakdown. [[src/auth.ts#rememberViews]] persists them with preferences; a different
Jira site or email clears them.

Pagination and local text searches are not saved. A failed preference write leaves the saved records unchanged and reports the error.

[[src/ui/views.ts#ViewPanel]] owns creation, chart navigation and drilldowns.
[[src/ui/view-form.ts#ViewForm]] holds a separate draft in the standard 60-column
[[src/ui/dialog.ts#dialogPanel]] with the native [[src/ui/search-input.ts#SearchInput]]
and [[src/ui/view-pickers.ts]] choices. Tab and Shift+Tab move fields, Enter opens
a picker, Ctrl+Enter creates, and Escape cancels. Nested picker dismissal returns
to the form. Search and Agent keep their own workspace navigation and shortcuts.

[[src/state/workspace.ts#Workspace]] restores a saved board and scope in one issue
request, retaining its existing cancellation and last-successful-result contracts.
[[src/ui/view-breakdown.ts#breakdown]] groups the loaded issue rows by the existing
workflow stage, assignee account ID, or open issue age. Missing or future creation
dates belong to Unknown age. Assignee and age omit completed issues. Counts and
drilldowns share these members. [[src/ui/issue-list.ts#IssueList]] applies the local
subset before its normal grouping, filtering and selection, including after refresh.
The full issue list retains its existing issue preview and detail reads.

[[src/ui/view-peek.ts#drawViewPeek]] previews the selected bar's exact loaded
members and share, owner counts by account ID, wrapped issue titles and any
available attention reason. Assignee previews omit the redundant owner summary.
No detail or Jira reads are started by opening, scrolling or moving the preview.
[[src/ui/peek-panel.ts#drawPeekPanel]] shares the existing issue drawer's surface,
pinned heading, scroll window and wheel targets. Space toggles the chart drawer;
arrow keys move the selected bar and reset its scroll. Shift+arrows, J/K and the
wheel over the drawer scroll only that preview. Escape closes it first; Enter or
a bar click closes it and opens the full list. Scope and breakdown changes close
it. Resizing hides it when it cannot fit; Space then opens the full list.
Refresh updates the same loaded members and clamps the scroll to available rows.
Refresh failures and partial-result warnings take footer space before optional
shortcut hints.

[[src/ui/view-chart.ts#drawViewChart]] uses the existing square glyph and theme palette,
on consecutive terminal rows. Nonzero buckets retain at least one square;
zero buckets stay empty. Selection and mouse targets follow the compact rows, and
scrolling keeps the selected bucket above the footer. Status colors match issue
icons; open issue age progresses from green through blue and purple to red, with
unknown ages and unassigned workload in muted gray.
The footer labels loaded counts, exposes Load more and retains refresh failures and
partial-result warnings. Saved views have one active sidebar destination, no mode
tabs, one breakdown picker, and Save changes only when their saved settings differ.
The Views picker reaches records beyond the sidebar's visible rows and on narrow
panes; deletion requires an explicit picker choice.
