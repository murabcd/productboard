/** Screen layout. The title bar comes first, followed by the page header and
 * body. The last row is the footer.
 * Key handling pages by these same sizes, so a page matches what is on screen. */

export const MIN_WIDTH = 60;
export const MIN_HEIGHT = 18;
/** Wide panes get the navigation sidebar; narrow ones put views in the top bar. */
export const sidebarWidth = (width: number): number => (width >= 96 ? 20 : 0);
export function headerRows(width: number) {
  const description = sidebarWidth(width) ? 1 : 2;
  return { description, toolbar: description + 2 };
}
export type SearchBoxKind = "jira" | "filter";

export function issueListLayout(width: number, box?: SearchBoxKind) {
  const { toolbar } = headerRows(width);
  const status = toolbar + 3;
  const input = toolbar + (box === "jira" ? 1 : 2);
  return { input, status, top: box ? input + 3 : status };
}
/** Picker choices and panel text start on this row. */
export const BODY_TOP = 8;
/** The footer and the blank row above it. */
export const FOOTER_ROWS = 2;
/** The peek panel opens beside the list when the workspace is this wide. */
export const PEEK_MIN_WIDTH = 100;
export const peekWidth = (workspace: number): number => Math.min(56, Math.max(38, Math.floor(workspace * 0.38)));

export const listRows = (width: number, height: number, box?: SearchBoxKind): number =>
  height - issueListLayout(width, box).top - FOOTER_ROWS;
export const modalRows = (height: number): number => height - BODY_TOP - FOOTER_ROWS;
/** Rows a dialog's list may take, headings included, capped on tall panes. */
export const pickerRows = (height: number): number => Math.min(12, Math.max(3, Math.floor(height / 2) - 6));

export function rowOffset(offset: number, selected: number, count: number, capacity: number): number {
  const first = selected < offset ? selected - 1 : Math.max(offset, selected - capacity + 1);
  return Math.max(0, Math.min(first, count - capacity));
}

export const COMPOSER_MAX_ROWS = 6;

export function agentLayout(width: number, height: number, composerRows: number) {
  const workspaceWidth = width - sidebarWidth(width);
  const room = Math.min(workspaceWidth - 5, 72);
  const left = Math.floor((workspaceWidth - room) / 2);
  const rows = Math.max(1, Math.min(COMPOSER_MAX_ROWS, composerRows));
  const status = height - FOOTER_ROWS - 1;
  const boxBottom = status - 1;
  const boxTop = boxBottom - rows - 1;
  const top = headerRows(width).toolbar + 2;
  return {
    left,
    rows,
    status,
    boxBottom,
    boxTop,
    transcript: { top, capacity: Math.max(1, boxTop - top - 1), room },
  };
}

export type AgentLayout = ReturnType<typeof agentLayout>;

export const composerMenuRows = ({ boxTop }: AgentLayout, headerRows: number): number =>
  Math.min(10, boxTop - 3 - headerRows);
