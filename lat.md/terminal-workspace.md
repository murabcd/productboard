# Terminal Workspace

[[src/state/workspace.ts#Workspace]] owns asynchronous list and catalog state.
It reads typed snapshots through [[jira-api]] and publishes state changes for
the terminal to draw.

## Refresh and scope

The current list stays visible during refresh and on refresh failure. Earlier
results cannot replace a new scope.

Startup opens Inbox and loads mentions alongside the board catalog.
A scope starts loading as soon as it is ready. Clearing server filters applies
one scope change. Board and project discovery and the selected board's sprint
catalog track their own failures and retry independently of the issue list.
The Filter menu uses the selected board's sprint catalog. Its optional sprint
filter carries across issue lists. Changing the sprint board in Filter clears
an active sprint filter and starts the new board’s sprint read immediately.
When no sprint filter is active, the board change leaves the loaded issue
pages and local filter intact. Only the current sprint request can publish
results or schedule a retry.

## Interaction and rendering

[[src/ui/dashboard.ts#Dashboard]] owns keyboard and mouse interactions, issue
selection, and panels. [[src/ui/frame.ts#frame]] computes what to draw, and
[[src/ui/screen.ts#mount]] connects input and drawing to OpenTUI. The CLI entry
point restores the terminal on exit.

Dashboard resolves the active input layer from the open views and the pane
size. Rendering and the OpenTUI adapter use that layer for composer focus and
key routing. The command palette follows the same activation path for keys and
clicks, so dismissing it returns to the page beneath it. The minimum-size
screen owns its quit shortcut even when Agent was active.

Use [[src/text.ts]] for remote text sanitization, grapheme handling, and cell
widths.

## Themes

[[src/theme.ts]] defines the built-in palettes. The command palette is the
only entry point for changing themes. [[src/auth.ts]] saves the selected
theme in the local preferences.

[[src/ui/theme.ts]] resolves the palette into semantic colors for the frame,
selection, and Agent composer. Switching themes recolors the existing renderer
and composer while preserving the active page and draft.

## Screen layout

The frame has a top bar, navigation sidebar, page header, body, and footer.
The footer shows counts, sync status, and shortcuts.

[[src/ui/navigation.ts#NAV_GROUPS]] puts one blank row between Search and Agent
and the rest of the sidebar pages.
[[src/ui/navigation.ts#NAVIGATION]] flattens that order for number keys, Tab,
and the command palette. On narrow panes, the same order appears as tabs
below the title bar.

[[src/ui/header.ts#pageHeader]] supplies the title for the row shared with the
app name and command palette shortcut. [[src/ui/header.ts#drawHeader]] draws
the description and toolbar below, including tabs, filters, and page actions.

[[src/ui/pickers.ts#PICKERS]] describes every picker in one table: boards,
sprints, filters, models, the command palette and the rest. Each item carries
the action it runs. [[src/ui/picker.ts#Picker]] owns the grouped row window,
highlight, search, and navigation. Catalog refreshes preserve the highlight
by choice value. Keyboard, wheel, and clicks all use that projection, and
the dialog only draws the visible rows.

[[src/ui/issue-list.ts#IssueList]] owns the projection for grouping, folded
rows, selected issue identity, and scrolling. Paging uses display rows so
group headings count against the same capacity the frame draws. The frame
uses that projection for the visible rows and issue count. This keeps
selection and viewport changes together across filtering and refresh.

Status groups are workflow stages from [[src/ui/status.ts#stage]]. Rows show
the key, the title, then reason, assignee, sprint and priority columns. A
column is left out when the view or headings already say the same thing.
[[src/ui/dialog.ts#drawDialog]] centers each picker in the content area beside
the sidebar. The picker has a search field and grouped choices and marks the
current choice.

[[src/ui/peek.ts#drawPeek]] shows the selected issue beside the list. The
dashboard loads details outside rendering. [[src/ui/issue-details.ts#IssueDetails]]
shares one read per issue key across Peek and full details. Both views observe
the same result while open. A retry retains the last successful details until
a new read settles. Completed reads are held by their open views, so the
dashboard does not keep a session-wide cache of issue details.

[[src/jira/adf.ts]] converts Jira documents to typed blocks, and
[[src/ui/document.ts]] lays those blocks out for the available terminal width.
In issue details, `i` previews a sole image attachment directly. For other
attachment lists, it opens the picker over the issue details.
[[src/ui/preview.ts#ImagePreviews]] owns image selection and downloads. Returning
to an image reuses its in-flight read or a recent successful result.

## Agent

The Agent page holds conversations about issues across Jira, managed by
[[src/agent/chat.ts#AgentChat]]. [[src/ui/agent-panel.ts#AgentPanel]] owns
whether Agent is shown and its keys.

The frame reserves areas that OpenTUI draws itself: the Agent text box and image
previews. Issue citations open the normal detail panel and can
return to the conversation. [[src/ui/transcript.ts#transcriptWindow]] shares
one viewport between drawing and scrolling. Page keys move by the visible
rows after the composer has taken its space. Transcript layout is reused
while the turn content and pane width stay the same.

[[src/agent/models.ts#listModels]] lists GPT-6 and Claude 5 models from each
provider with a key. Choosing one, then a reasoning level, restarts the Eve process with both
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
start of a word opens a centered context picker with grouped task and sprint
results. [[src/ui/context-picker.ts#ContextPicker]] owns lookup, result ordering
and the selected reference. It cancels pending searches when the query changes
or the picker closes. [[src/jira/client.ts#JiraClient]] searches across Jira
projects and Jira matches appear before loaded tasks. Sprints come from the
current board. The composer inserts the selected reference at the cursor. Task keys are
passed in the prompt and a sprint scopes the next message.

Eve's Jira search tool calls [[src/agent/jira-search.ts#openJiraSearch]]
over an authenticated loopback connection owned by the dashboard. The tool can
only search Jira and returns at most 50 matches per call. It sends a projection
of the results to the model and emits the issue records through the event stream for
terminal citations. Jira credentials stay in the dashboard. Provider
credentials come from the shell or macOS Keychain. The dashboard keeps
conversation history in memory and cancels pending work on exit. Sessions,
search access and streaming callbacks belong to the Eve process that created
them.
