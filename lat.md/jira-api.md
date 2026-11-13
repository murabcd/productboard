# Jira API

[[src/jira/client.ts#JiraClient]] reads Jira Cloud directly. It owns issue,
comment, and catalog pagination and returns typed data to the
[[terminal-workspace]]. [[src/jira/parse.ts]] validates Jira payloads and
normalizes them before they reach workspace state.

## Credentials and transport

[[src/auth.ts]] keeps the API token under the `productboard` service in macOS
Keychain and stores the site, email, and last board in
`~/.config/productboard/config.json`.

[[src/jira/http.ts#JiraHttp]] sends authorization to the configured Jira site
and follows attachment redirects without forwarding it. Search uses POST as a
read operation.

Transport owns timeouts, retries, rate limit handling, request priority, and
the 20 MiB attachment preview limit. It stops reading an oversized stream
even when Jira omits its size.
Catalog pagination and Agent searches run at background priority, leaving
slots for interactive reads. The timeout starts when a read receives a slot.
Canceling an Agent search or replacing an issue or sprint scope removes
queued reads and aborts active requests, including follow-up pages and
comment reads. Closing the transport cancels all reads.

## Issue queries

[[src/jira/query.ts#jql]] owns Jira-side filtering. Team focus retains team-wide
scope. Assigned and Created match the current user against the issue's
assignee and creator fields, respectively. The local filter searches loaded rows.

`--check` uses [[src/jira/client.ts#JiraClient]] to load the first page of
recently updated issues without applying a workspace view.

The optional sprint filter adds a Jira sprint ID to the current view's query.
Team focus applies the project, sprint, assignee, and status filters to its searches.
With the Done filter, only recent mentions and changes to your issues are
queried because the other sections show open work.

Each site stores sprints in its own custom field, so [[src/jira/client.ts#JiraClient]]
looks up the field ID once per session and asks for it with every search. Lists
still load without sprints when that lookup fails.

Mentions scans comments on recently updated issues for the current account ID.
It requests full threads when the issue search response lacks a complete one.
[[src/jira/today.ts#today]] groups issues by urgency, with each issue appearing
in the first applicable section. Each reason adds something the row's status
does not already show: a blocker's cause, idle days, who mentioned you, or when
your issue last changed. Ready-for-release work waits on a release, so it gets
its own late section instead of counting as stuck.
