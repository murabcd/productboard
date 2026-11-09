# Terminal Workspace

[[src/state/workspace.ts#Workspace]] owns asynchronous list and catalog state.
It reads typed snapshots through [[jira-api]] and publishes state changes for
the terminal to draw.

## Refresh and scope

The current list stays visible during refresh and on refresh failure. A new
scope starts loading immediately, and earlier results cannot replace it.
Board and sprint discovery runs separately from issue loading.

## Interaction and rendering

[[src/ui/dashboard.ts#Dashboard]] owns keyboard and mouse interactions, issue
selection, and panels. [[src/ui/frame.ts#frame]] computes what to draw, and
[[src/ui/screen.ts#mount]] connects input and drawing to OpenTUI. The CLI entry
point restores the terminal on exit.

Use [[src/text.ts]] for remote text sanitization, grapheme handling, and cell
widths. [[src/jira/adf.ts]] converts Jira documents to typed blocks, and
[[src/ui/document.ts]] lays those blocks out for the available terminal width.
