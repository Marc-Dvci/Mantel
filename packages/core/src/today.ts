/**
 * The Today screen, computed.
 *
 * The screen answers the questions a person with dementia asks most before
 * they are asked: what day it is, what part of the day, what happens next and
 * who is coming. It is a pure function of the household and the clock, so the
 * TV can recompute it every minute with no network.
 */

import type { Household, PlanItem } from "./model";
import { memberById } from "./model";
import {
  WEEKDAYS,
  clockFace,
  inWindow,
  localParts,
  longDate,
  parseClock,
  partOfDay,
  spokenDate,
  spokenTime,
  spokenTimeWords,
  type PartOfDay,
} from "./time";

export type ScreenMode = "day" | "evening" | "night";

export interface NextUp {
  itemId: string;
  line: string;
  speech: string;
  photo?: string;
  minutesAway: number;
  soon: boolean;
}

export interface TodayBoard {
  date: string;
  dayName: string;
  dateLine: string;
  clock: string;
  partOfDay: PartOfDay;
  headline: string;
  mode: ScreenMode;
  next?: NextUp;
  later: string[];
  done: string[];
  nightLines: string[];
  /** One sentence for the speech engine: "It's Tuesday afternoon, the 29th of September." */
  speech: string;
}

export function screenMode(h: Household, minuteOfDay: number): ScreenMode {
  const s = h.settings;
  if (inWindow(minuteOfDay, parseClock(s.bedtime), parseClock(s.wake))) return "night";
  if (inWindow(minuteOfDay, parseClock(s.evening.start), parseClock(s.evening.end))) return "evening";
  return "day";
}

export function itemsOn(h: Household, date: string): PlanItem[] {
  return h.plan
    .filter((p) => p.date === date)
    .sort((a, b) => parseClock(a.time) - parseClock(b.time));
}

/** "Sarah is coming at 4 o'clock", "Lunch at half past 12". */
export function itemLine(item: PlanItem): string {
  return `${item.title} at ${spokenTime(parseClock(item.time))}`;
}

function itemSpeech(item: PlanItem): string {
  return `${item.title} at ${spokenTimeWords(parseClock(item.time))}`;
}

/** What the bottom line says about a finished item. */
export function doneLine(h: Household, item: PlanItem): string {
  const tz = h.settings.timezone;
  const when = item.doneAt ? spokenTime(localParts(new Date(item.doneAt), tz).minuteOfDay) : undefined;
  switch (item.kind) {
    case "meal":
      return `${item.title} is done.`;
    case "pills":
      return when ? `Pills taken at ${when}.` : "Pills taken.";
    case "visit": {
      const who = memberById(h, item.who);
      return who ? `${who.name} came${when ? ` at ${when}` : ""}.` : `${item.title}: done.`;
    }
    case "delivery":
      return "The parcel came.";
    default:
      return `${item.title}: done.`;
  }
}

/**
 * An item stays "next" until it is marked done or its visit window closes, so
 * the screen does not drop "Sarah is coming at 4" at 4:01 while she parks.
 */
function stillAhead(h: Household, item: PlanItem, minuteOfDay: number): boolean {
  if (item.doneAt) return false;
  const t = parseClock(item.time);
  const grace = item.kind === "visit" ? h.settings.visitWindowMinutes : item.kind === "delivery" ? 0 : 10;
  const end = item.until ? parseClock(item.until) : t + grace;
  return minuteOfDay < end;
}

export function computeToday(h: Household, now: Date | number): TodayBoard {
  const tz = h.settings.timezone;
  const p = localParts(now, tz);
  const pod = partOfDay(p.minuteOfDay);
  const dayName = WEEKDAYS[p.weekday] ?? "";
  const items = itemsOn(h, p.date);
  const ahead = items.filter((i) => stillAhead(h, i, p.minuteOfDay));
  const first = ahead[0];
  let next: NextUp | undefined;
  if (first) {
    const minutesAway = parseClock(first.time) - p.minuteOfDay;
    const who = memberById(h, first.who);
    next = {
      itemId: first.id,
      line: itemLine(first),
      speech: itemSpeech(first),
      ...(who?.photo ? { photo: who.photo } : {}),
      minutesAway,
      soon: minutesAway <= 30,
    };
  }
  const done = items.filter((i) => i.doneAt).slice(-2).map((i) => doneLine(h, i));
  const later = ahead.slice(1, 3).map(itemLine);
  const mode = screenMode(h, p.minuteOfDay);
  const nightLines = h.settings.nightLines?.length
    ? h.settings.nightLines
    : ["It's night-time.", "Everyone is asleep.", "Your bed is ready."];
  return {
    date: p.date,
    dayName,
    dateLine: longDate(p.date),
    clock: clockFace(p.minuteOfDay),
    partOfDay: pod,
    headline: pod === "night" ? `${dayName} night` : `${dayName} ${pod}`,
    mode,
    ...(next ? { next } : {}),
    later,
    done,
    nightLines,
    speech: `It's ${dayName} ${pod === "night" ? "night" : pod}, ${spokenDate(p.date)}.`,
  };
}
