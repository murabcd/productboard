/** Dates as shown: US style, "11/05/2026" and "11/05/2026 1:08 PM".
 * Jira data stays ISO ("2026-11-05", "2026-11-05 13:08") so it compares and
 * sorts as text; only the screen uses these. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const ISO_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/;

export function usDate(iso: string): string {
  const match = ISO_DATE.exec(iso);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : iso;
}

export function usDateTime(iso: string): string {
  const match = ISO_TIME.exec(iso);
  if (!match) return usDate(iso);
  const hour = Number(match[2]);
  return `${usDate(match[1] ?? "")} ${hour % 12 || 12}:${match[3]} ${hour < 12 ? "AM" : "PM"}`;
}

/** A moment's local time of day, e.g. "1:08:14 PM". */
export const usTime = (date: Date): string => date.toLocaleTimeString("en-US");
