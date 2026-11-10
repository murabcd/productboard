/** Screen layout. Row 0 is the title bar, rows 1–4 hold navigation and view
 * controls, row 5 holds the column headings, and the last row is the footer.
 * Key handling pages by these same sizes, so a page matches what is on screen. */

export const MIN_WIDTH = 60;
export const MIN_HEIGHT = 18;
/** Wide panes get the navigation sidebar; narrow ones put views in the top bar. */
export const sidebarWidth = (width: number): number => (width >= 96 ? 20 : 0);
/** Issues start on this row, or two rows lower under a search box. */
export const LIST_TOP = 6;
/** Rows a search box takes above the list: the box and a gap. */
export const BOX_ROWS = 2;
/** Picker choices and panel text start on this row. */
export const BODY_TOP = 8;
/** The footer bar: counts, sync status and a few keys. */
export const FOOTER_ROWS = 1;
/** The peek panel opens beside the list when the workspace is this wide. */
export const PEEK_MIN_WIDTH = 100;
export const peekWidth = (workspace: number): number => Math.min(56, Math.max(38, Math.floor(workspace * 0.38)));

export const listRows = (height: number, boxed = false): number =>
  height - LIST_TOP - FOOTER_ROWS - (boxed ? BOX_ROWS : 0);
export const modalRows = (height: number): number => height - BODY_TOP - FOOTER_ROWS - 1;
export const DIALOG_WIDTH = 60;
/** Rows a dialog's list may take, headings included: up to half the pane. */
export const pickerRows = (height: number): number => Math.max(3, Math.floor(height / 2) - 6);

export function rowOffset(offset: number, selected: number, count: number, capacity: number): number {
  const first = selected < offset ? selected - 1 : Math.max(offset, selected - capacity + 1);
  return Math.max(0, Math.min(first, count - capacity));
}
