/** The pages of the workspace, in sidebar order. Page names, number keys,
 * Tab, the narrow top bar and the command palette all come from here. */

import { View } from "../jira/query";

/** A view, or the Agent conversation. */
export type Destination = View | "agent";

export interface NavItem {
  to: Destination;
  /** The page's name: its title, sidebar label and command. */
  name: string;
  icon: string;
  /** The narrow top bar's tab label. */
  short: string;
}

const item = (to: Destination, icon: string, name: string, short: string): NavItem => ({
  to,
  icon,
  name,
  short,
});

const SEARCH = item(View.Search, "⌕", "Search", "Find");
const INBOX = item(View.Mentions, "◉", "Inbox", "Inbox");
const MY_ISSUES = item(View.Mine, "◫", "My issues", "Me");
export const AGENT = item("agent", "✦", "Agent", "Agent");
const TEAM_FOCUS = item(View.Today, "◇", "Team focus", "Focus");
const ALL_ISSUES = item(View.All, "≡", "All issues", "All");

export const NAV_GROUPS: readonly (readonly NavItem[])[] = [
  [SEARCH, AGENT],
  [INBOX, MY_ISSUES, TEAM_FOCUS, ALL_ISSUES],
];
export const NAVIGATION: readonly NavItem[] = NAV_GROUPS.flat();

/** The page each view belongs to; Created is a tab of My issues. */
const PAGES: Record<View, NavItem> = {
  [View.Mentions]: INBOX,
  [View.Mine]: MY_ISSUES,
  [View.Created]: MY_ISSUES,
  [View.Today]: TEAM_FOCUS,
  [View.All]: ALL_ISSUES,
  [View.Search]: SEARCH,
};

export const pageOf = (view: View): NavItem => PAGES[view];

/** My issues' tabs. */
export const MY_ISSUES_TABS: readonly [View, string][] = [
  [View.Mine, "Assigned"],
  [View.Created, "Created"],
];

/** The number key for an item in sidebar order. */
export const navKey = (nav: NavItem): string => String(NAVIGATION.indexOf(nav) + 1);

/** Views in navigation order, for Tab. */
export const NAV_VIEWS: readonly View[] = NAVIGATION.flatMap(({ to }) => (to === "agent" ? [] : [to]));

/** The page on screen: Agent, or the current view's page. */
export const currentPage = (view: View, agent: boolean): NavItem => (agent ? AGENT : pageOf(view));
