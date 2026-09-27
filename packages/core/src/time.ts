/**
 * Household-local time.
 *
 * Every rule in Mantel is written in the household's wall-clock time ("pills at
 * 9", "Sarah at 4"), while events are stored as UTC instants. This module is the
 * only place the two meet. It uses Intl, so it needs no timezone database of its
 * own and gives the same answer in Node, in the browser and in Android WebView.
 */

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export interface LocalParts {
  /** YYYY-MM-DD in the household's timezone. */
  date: string;
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  weekday: number; // 0 = Sunday
  /** Minutes since local midnight. */
  minuteOfDay: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localParts(at: Date | number, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(typeof at === "number" ? new Date(at) : at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const weekday = SHORT_DAYS.indexOf(get("weekday"));
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    year,
    month,
    day,
    hour,
    minute,
    weekday,
    minuteOfDay: hour * 60 + minute,
  };
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "16:05" to 965. Throws on anything that is not HH:MM. */
export function parseClock(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Not a clock time: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Not a clock time: ${hhmm}`);
  return h * 60 + min;
}

export function formatClock(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/**
 * The UTC instant of a household wall-clock time. Resolves the zone offset by
 * asking Intl what the guessed instant looks like locally and correcting, twice,
 * which settles across a DST boundary.
 */
export function zonedInstant(date: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const target = parseClock(hhmm);
  let guess = Date.UTC(y, mo - 1, d, Math.floor(target / 60), target % 60);
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, timeZone);
    const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const wanted = Date.UTC(y, mo - 1, d, Math.floor(target / 60), target % 60);
    const diff = wanted - localAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export type PartOfDay = "morning" | "afternoon" | "evening" | "night";

/** Morning from 05:00, afternoon from 12:00, evening from 17:00, night from 21:00. */
export function partOfDay(minuteOfDay: number): PartOfDay {
  if (minuteOfDay >= 5 * 60 && minuteOfDay < 12 * 60) return "morning";
  if (minuteOfDay >= 12 * 60 && minuteOfDay < 17 * 60) return "afternoon";
  if (minuteOfDay >= 17 * 60 && minuteOfDay < 21 * 60) return "evening";
  return "night";
}

const HOUR_WORDS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];

/**
 * A time as a person says it: "4 o'clock", "half past 4", "quarter to 5",
 * "4:20". Digits for the hour, because the phrase is also shown on screen.
 */
export function spokenTime(minuteOfDay: number): string {
  const h24 = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const next = ((h24 + 1) % 12) === 0 ? 12 : (h24 + 1) % 12;
  if (h24 === 12 && m === 0) return "midday";
  if (h24 === 0 && m === 0) return "midnight";
  if (m === 0) return `${h12} o'clock`;
  if (m === 30) return `half past ${h12}`;
  if (m === 15) return `quarter past ${h12}`;
  if (m === 45) return `quarter to ${next}`;
  return `${h12}:${pad(m)}`;
}

/** The same phrase, spelled for a speech engine ("half past four"). */
export function spokenTimeWords(minuteOfDay: number): string {
  // "4:20" is left to the speech engine, which reads it correctly.
  return spokenTime(minuteOfDay).replace(/(?<![:\d])(\d{1,2})(?![:\d])/g, (_, n: string) => HOUR_WORDS[Number(n) % 12] ?? n);
}

/** "3:58", the clock face on the Today screen (12-hour, no leading zero). */
export function clockFace(minuteOfDay: number): string {
  const h24 = Math.floor(minuteOfDay / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(minuteOfDay % 60)}`;
}

/** "September 29". */
export function longDate(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}`;
}

/** "the 29th of September", for speech. */
export function spokenDate(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `the ${ordinal(d)} of ${MONTHS[m - 1]}`;
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Is a wall-clock minute inside [start, end), where the window may wrap midnight? */
export function inWindow(minuteOfDay: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end;
}

/** Relative day word for a plan date seen from today: "today", "tomorrow", "on Thursday", "on October 2". */
export function relativeDay(today: string, date: string): string {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  for (let i = 2; i <= 6; i++) {
    if (date === addDays(today, i)) return `on ${WEEKDAYS[weekdayOf(date)]}`;
  }
  return `on ${longDate(date)}`;
}
