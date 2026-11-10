# Terminal Workspace

[[src/state/workspace.ts#Workspace]] owns asynchronous list and catalog state.
It reads typed snapshots through [[jira-api]] and publishes state changes for
the terminal to draw.

## Refresh and scope

The current list stays visible during refresh and on refresh failure. Earlier
results cannot replace a new scope.

A scope starts loading as soon as it is ready. Clearing server filters applies
one scope change. Board and project discovery and the selected board's sprint
catalog track their own failures and retry independently of the issue list.

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

## Screen layout

The frame has a top bar, navigation sidebar, page header, body, and footer.
The footer shows counts, sync status, and shortcuts.

[[src/ui/navigation.ts#NAVIGATION]] lists the pages in sidebar order and is
the one source for page names, number keys, Tab and the command palette. The
sidebar moves into the top bar on narrow panes.

[[src/ui/header.ts#drawHeader]] draws the same header on every page: the title,
a description, and one toolbar with tabs, board and sprint, the Filter menu,
active filters, and page actions on the right.

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
[[src/ui/dialog.ts#drawDialog]] draws each picker over the page with a search
field and grouped choices. It marks the current choice.

[[src/ui/peek.ts#drawPeek]] shows the selected issue beside the list. The
dashboard loads details outside rendering. [[src/ui/issue-details.ts#IssueDetails]]
shares one read per issue key across Peek and full details. Both views observe
the same result while open. A retry retains the last successful details until
a new read settles. Completed reads are held by their open views, so the
dashboard does not keep a session-wide cache of issue details.

[[src/jira/adf.ts]] converts Jira documents to typed blocks, and
[[src/ui/document.ts]] lays those blocks out for the available terminal width.
[[src/ui/preview.ts#ImagePreviews]] owns image selection and downloads. Returning
to an image reuses its in-flight read or a recent successful result.

## Agent

The Agent page holds a sprint-scoped conversation managed by
[[src/agent/chat.ts#AgentChat]]. [[src/ui/agent-panel.ts#AgentPanel]] owns
whether Agent is shown and its keys.

The frame reserves areas that OpenTUI draws itself: the Agent text box and image
previews. Issue citations open the normal detail panel and can
return to the conversation.

[[src/agent/models.ts#listModels]] lists GPT-6 and Claude 5 models from each
provider with a key. Choosing one, then a reasoning level, restarts the Eve process with both
and saves them; each reply records the model and level that wrote it.

[[src/agent/eve.ts#EveAgent]] starts a local Eve subprocess when the user asks
a question. It reads a bounded sprint snapshot and passes the selected fields
and the prompt to the configured provider using ACP. Jira transport and
credentials stay in the dashboard. Provider credentials come from the shell
or macOS Keychain. The dashboard keeps conversation history in memory and
cancels pending work on exit.
