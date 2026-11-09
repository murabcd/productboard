/** Terminal-safe text: strip controls from remote data and measure columns. */

const CONTROLS = /\p{C}/gu;
const CONTROLS_EXCEPT_NEWLINE = /(?!\n)\p{C}/gu;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Keep remote text from emitting terminal controls or bidi overrides. */
export function clean(text: string, multiline = false): string {
  return text.replace(multiline ? CONTROLS_EXCEPT_NEWLINE : CONTROLS, "");
}

/** Terminal columns a string occupies (Bun's native measure: wide CJK,
 * zero-width marks and emoji included). */
export function cells(text: string): number {
  return Bun.stringWidth(text);
}

export function splitGraphemes(text: string): string[] {
  return Array.from(graphemes.segment(text), (part) => part.segment);
}

/** Fit text into `width` columns, ending with … when it had to be cut. */
export function clip(text: string, width: number): string {
  if (width <= 0) return "";
  if (cells(text) <= width) return text;
  let result = "";
  let used = 0;
  for (const segment of splitGraphemes(text)) {
    const size = cells(segment);
    if (used + size > width - 1) break;
    result += segment;
    used += size;
  }
  return `${result}…`;
}
