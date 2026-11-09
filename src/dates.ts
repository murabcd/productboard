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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_MS = 86_400_000;

/** "2026-11-09" for a moment, in this computer's timezone. */
export const localDay = (ms: number): string => new Date(ms).toLocaleDateString("sv-SE");

/** "Nov 9" this year, "Mar 5, 2025" in another. */
export function shortDate(iso: string, now = Date.now()): string {
  const match = ISO_DATE.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  const text = `${MONTHS[Number(month) - 1]} ${Number(day)}`;
  return year === localDay(now).slice(0, 4) ? text : `${text}, ${year}`;
}

/** When something happened, as short as stays clear: "2:14 PM" today, else "Nov 9". */
export function when(iso: string, now = Date.now()): string {
  if (iso.slice(0, 10) !== localDay(now)) return shortDate(iso, now);
  return usDateTime(iso).split(" ").slice(1).join(" ") || shortDate(iso, now);
}

/** A heading for a stretch of time: Today, Yesterday, This week (from Monday),
 * Earlier this month, then month names this year and years before that. */
export function period(iso: string, now = Date.now()): string {
  const day = iso.slice(0, 10);
  const today = localDay(now);
  if (!ISO_DATE.test(day)) return "Earlier";
  if (day >= today) return "Today";
  if (day === localDay(now - DAY_MS)) return "Yesterday";
  const weekday = (new Date(now).getDay() + 6) % 7;
  if (day >= localDay(now - weekday * DAY_MS)) return "This week";
  if (day.slice(0, 7) === today.slice(0, 7)) return "Earlier this month";
  if (day.slice(0, 4) === today.slice(0, 4)) return MONTH_NAMES[Number(day.slice(5, 7)) - 1] ?? day;
  return day.slice(0, 4);
}
