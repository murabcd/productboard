export const HELP = `JIRA · TEAM WORKSPACE

1 Sprints   Choose a board and an active, planned or closed sprint
2 All tasks Everyone's issues, across all accessible projects
3 Assigned  Issues assigned to you
4 Created   Issues created by you, regardless of current assignee
5 Today     What needs attention: blocked, stuck, no owner, overdue, mentions
6 Mentions  Comments that @-mention you, in issues updated in 14 days
7 Search    Issues anywhere in Jira matching your words, or one issue key

b           Choose board (then choose its sprint)
s           Choose sprint; Tab switches active / future / closed / all
p           Filter by project, or choose All projects
a           Filter by a person in the loaded issues, or All people
d           Cycle all / open / done statuses
g           Group by actual Jira status / assignee
n           Load 200 more issues when more results exist
/           Filter the loaded issues, including assignee names
f           Find in all of Jira: words in summaries, descriptions and
            comments, or an issue key like EX-123; Enter runs the search,
            Esc clears it for a new one
↑/↓  j/k    Select an issue; PgUp/PgDn moves a page
Home / End  First / last issue
Tab         Next view
Enter / v   Read issue details and comments; ↑/↓ and PgUp/PgDn scroll
i           In details: choose an attachment to preview or open
t           Read selected sprint's goal and dates
o           Open selected issue in Helium
y           Copy issue URL
r           Refresh; retry failed boards, projects or sprints
Esc         Clear the filter or search; close a picker or details
q / Ctrl-C  Quit, or close details
Mouse       Click a tab or issue; click again to open; wheel scrolls

Lists load the newest 200 issues first; n loads more. Counts and grouping
refer to loaded issues. Search filters this loaded set. Scope filters
(project, person, status) run on Jira before loading the list.
Filters are shared across views; Assigned always targets you. Today covers
active sprints: blocked (status, flag or open blocker), in progress with no
update for 5+ days, unassigned, overdue; then mentions, your own issues, and
work untouched for 30+ days (usually a sprint nobody closed).
Created uses Jira's creator, rather than reporter. Sprint membership
comes from Jira. Old active sprints remain active until Jira closes them.
Refresh runs every 60 seconds; failed requests retry automatically.`;
