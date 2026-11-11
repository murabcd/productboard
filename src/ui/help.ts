/** The keyboard shortcuts, by where they work. Pages come from the sidebar's own list. */

import { NAVIGATION, navKey } from "./navigation";

const section = (title: string, rows: [keys: string, does: string][]): string =>
  [title, ...rows.map(([keys, does]) => `  ${keys.padEnd(14)}${does}`)].join("\n");

export const HELP = [
  section("Pages", [
    ...NAVIGATION.map((page): [string, string] => [navKey(page), page.name]),
    ["Tab", "Next page"],
    ["← →", "My issues: Assigned / Created"],
    ["Ctrl-K", "Commands"],
  ]),
  section("Issues", [
    ["↑ ↓  j k", "Select"],
    ["PgUp PgDn", "Page up / down"],
    ["Home End", "First / last"],
    ["Enter", "Details"],
    ["Space", "Peek; Esc closes it"],
    ["Shift-↑ ↓  J K", "Scroll the peek"],
    ["o  y", "Open in Helium / copy link"],
    ["z  Z", "Fold the group / unfold all"],
    ["n", "Load more"],
    ["r", "Refresh"],
  ]),
  section("Filters", [
    ["/", "Filter loaded issues"],
    ["f", "Search all of Jira"],
    ["F", "Filter menu"],
    ["D", "Display menu"],
    ["b  s", "Sprint board / sprint filter"],
    ["p  a", "Project / person"],
    ["d", "Cycle all / open / done"],
    ["g", "Group by status / assignee"],
    ["t", "Sprint brief"],
    ["Esc", "Clear the filter or search"],
  ]),
  section("Details", [
    ["↑ ↓  PgUp PgDn", "Scroll"],
    ["i", "Attachments"],
    ["Esc", "Back"],
  ]),
  section("Agent", [
    ["Enter", "Send"],
    ["Shift-Enter", "New line (or Ctrl-J)"],
    ["Esc", "Interrupt the reply, then leave"],
    ["Ctrl-N", "New chat"],
    ["Ctrl-↑ Ctrl-↓", "Previous / next chat"],
    ["Ctrl-O", "Issues Agent mentioned"],
    ["PgUp PgDn", "Scroll the conversation"],
  ]),
  section("App", [
    ["?", "These shortcuts"],
    ["q  Ctrl-C", "Quit"],
  ]),
].join("\n\n");
