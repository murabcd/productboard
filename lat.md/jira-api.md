# Jira API

[[src/jira/client.ts#JiraClient]] reads Jira Cloud directly. It owns issue,
comment, and catalog pagination and returns typed data to the
[[terminal-workspace]]. [[src/jira/parse.ts]] validates Jira payloads and
normalizes them before they reach workspace state.

## Credentials and transport

[[src/auth.ts]] keeps the API token under the `productboard` service in macOS
Keychain and stores the site, email, and last board in
`~/.config/productboard/config.json`.

The optional workflow preferences belong to that site and are cleared, along
with the remembered board, when the site changes.

[[src/jira/http.ts#JiraHttp]] sends authorization to the configured Jira site
and follows attachment redirects without forwarding it. Search uses POST as a
read operation.

Transport owns timeouts, retries, rate limit handling, request priority, and
the 20 MiB attachment preview limit. Each attempt sends one request; slow
requests are not duplicated speculatively. Failed connections and timeouts retain
the normal retry policy. It stops reading an oversized stream
even when Jira omits its size.
Catalog pagination and Agent searches run at background priority, leaving
slots for interactive reads. The timeout starts when a read receives a slot.
Canceling an Agent search or replacing an issue or sprint scope removes
queued reads and aborts active requests, including follow-up pages and
comment reads. Closing the transport cancels all reads.

## Issue queries

[[src/jira/query.ts#jql]] owns Jira-side filtering. Team issues retains team-wide
scope in both All issues and Needs attention. The local filter searches loaded rows.

All issues uses the standard paginated search with no attention, personal, sprint,
or status restriction unless selected in the filters. Assigned and Created match
the current user against the issue’s assignee and creator fields, respectively.

`--check` uses [[src/jira/client.ts#JiraClient]] to load the first page of
recently updated issues without applying a workspace view.

The optional sprint filter adds a Jira sprint ID to the current view's query.
Needs attention applies the project, sprint, assignee, and status filters to its searches.
[[src/jira/assignee.ts#AssigneeFilter]] represents an Include or Exclude account
set with display labels. [[src/jira/query.ts#jql]] applies that set to every issue
read, including attention searches and saved scopes. Unassigned is a separate
selection. Excluding accounts retains empty assignees unless Unassigned is also
excluded; mixed selections are grouped before combining with other filters.
Scope equality compares mode and account membership, ignoring selection order
and display labels, so caches and late-response checks share the same identity.
An empty selection means everyone. Opening Assigned clears the person filter;
applying a nonempty filter there transitions to Team issues.
With the Done filter, only recent mentions and changes to your issues are
queried because the other sections show open work.

Needs attention checks all open work in the selected scope, without requiring
an active sprint or a sprint-capable board. [[src/jira/attention-reads.ts#readAttention]] keeps
successful checks when another fails and returns warnings with the snapshot.
The terminal marks these results as partial. Complete failure, expired
credentials, and scope cancellation remain errors. Each paginated source
contributes to the load-more indicator.

[[src/jira/client.ts#JiraClient]] exposes board and project reads separately so
missing Jira Software access cannot discard accessible projects. The workspace
publishes and retries each catalog independently.

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

## Workflow interpretation

[[src/jira/workflow.ts#Workflow]] validates per-site status and blocker-link
mappings. [[src/jira/workflow.ts#workflowStage]] uses Jira categories as the
baseline and keeps Done authoritative.

Exact status mappings, ignoring case
and surrounding spaces, refine open-work stages; common English names provide
defaults. [[src/jira/parse.ts#toIssue]] carries the resolved stage into the
domain issue so grouping, colors, and attention use the same interpretation.
The same workflow classifier handles older Agent records that have no resolved stage.
[[src/agent/jira-search.ts#openJiraSearch]] uses the client's parsed issue pages
and preserves the resolved stage in validated Agent results and saved chats.
Blocker detection matches inward dependency links using the configured link
type names, which default to Blocks.

## Creation dates for saved views

[[src/jira/parse.ts#LIST_FIELDS]] requests `created` with list records.
[[src/jira/parse.ts#toIssue]] normalizes valid Jira timestamps once to milliseconds
in [[src/jira/types.ts#Issue]]. Missing or invalid timestamps remain absent, so
[[src/ui/view-breakdown.ts#breakdown]] preserves those rows under Unknown age.
The charts perform no additional Jira reads or writes.
