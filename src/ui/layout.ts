/** Screen layout. Rows 0–5 hold the header and the bottom rows hold footers.
 * Key handling pages by these same sizes, so a page matches what is on screen. */

export const MIN_WIDTH = 60;
export const MIN_HEIGHT = 18;
/** Issues start on this row. */
export const LIST_TOP = 6;
/** Picker choices and modal text start on this row. */
export const BODY_TOP = 9;

export const listRows = (height: number): number => height - 15;
export const modalRows = (height: number): number => height - 14;
/** Each picker choice takes two lines. */
export const pickerRows = (height: number): number => Math.max(1, Math.floor((height - 13) / 2));

/** Where an image preview is drawn: below the title, above the footer. */
export const previewArea = (width: number, height: number) => ({
  left: 2,
  top: BODY_TOP,
  width: Math.max(1, width - 4),
  height: Math.max(1, height - BODY_TOP - 5),
});
