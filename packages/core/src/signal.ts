/**
 * The Change Signal.
 *
 * Delirium on top of dementia shows as a sudden change over one or two days;
 * dementia itself drifts over months. Mantel already produces the series that
 * separate the two as a by-product of its features, one value per care day:
 *
 *   questions       questions asked out loud (answered or not)
 *   nightMinutes    minutes in the living room during the night
 *   nightDoorOpens  outside-door openings during the night
 *   firstSeen       minutes after the planned wake time the person was first seen
 *
 * Each value is compared with the person's own last 28 usual days (median and
 * scaled MAD, or mean and standard deviation for the two night series, which
 * are mostly zero), so the signal is a deviation from their own normal and a slow
 * drift moves the baseline with it. A care day is the daytime of a date plus
 * the night that follows it, and it is evaluated the next morning. The night
 * runs from bedtime to an hour before the planned waking time, so an early
 * riser is not counted as up at night.
 *
 * The rule and every constant below were fixed before the held-out benchmark
 * households were generated. See docs/EVAL.md.
 */

import type { Alert, Household, MantelEvent } from "./model";
import { WEEKDAYS, addDays, clockFace, clockWithPeriod, longDate, parseClock, weekdayOf, zonedInstant } from "./time";

export const SERIES = ["questions", "nightMinutes", "nightDoorOpens", "firstSeen"] as const;
export type Series = (typeof SERIES)[number];

export interface DayFeatures {
  date: string;
  questions: number | null;
  nightMinutes: number | null;
  nightDoorOpens: number | null;
  firstSeen: number | null;
  /** The family marked the day unusual (hospital, holiday): never in a baseline, never alerted. */
  unusual?: boolean;
}

export const BASELINE_DAYS = 28;
export const MIN_BASELINE_DAYS = 7;
export const FLAG_Z = 3;
export const PERSIST_Z = 2.5;
export const COOLDOWN_DAYS = 3;
export const NIGHT_ENDS_BEFORE_WAKE_MIN = 60;

const ABS_FLOOR: Record<Series, number> = { questions: 2, nightMinutes: 10, nightDoorOpens: 0.5, firstSeen: 20 };
const TWO_SIDED = new Set<Series>(["firstSeen"]);
/**
 * Most nights are zero minutes and zero door openings, so a median and MAD
 * collapse to zero and any restless night looks extreme. These two series are
 * centred on the mean and scaled by the standard deviation, which carries the
 * household's normal tail of restless nights.
 */
const ZERO_INFLATED = new Set<Series>(["nightMinutes", "nightDoorOpens"]);

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export interface Baseline {
  median: number;
  scale: number;
  n: number;
}

export function baseline(values: number[], series: Series): Baseline | undefined {
  if (values.length < MIN_BASELINE_DAYS) return undefined;
  if (ZERO_INFLATED.has(series)) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1));
    return { median: mean, scale: Math.max(sd, ABS_FLOOR[series]), n: values.length };
  }
  const med = median(values);
  const mad = 1.4826 * median(values.map((v) => Math.abs(v - med)));
  // Counts are at least Poisson-noisy, so the scale never drops below sqrt(median).
  const floor = series === "questions" ? Math.max(ABS_FLOOR[series], Math.sqrt(Math.max(0, med))) : ABS_FLOOR[series];
  return { median: med, scale: Math.max(mad, floor), n: values.length };
}

export interface SeriesReading {
  series: Series;
  value: number;
  baseline: Baseline;
  z: number;
}

export interface DayReading {
  date: string;
  readings: SeriesReading[];
  flagged: Series[];
}

/** z-scores for day `i`, each against the preceding usual days. */
export function readDay(history: DayFeatures[], i: number): DayReading {
  const day = history[i]!;
  const readings: SeriesReading[] = [];
  for (const s of SERIES) {
    const value = day[s];
    if (value === null || day.unusual) continue;
    const prior: number[] = [];
    for (let j = i - 1; j >= 0 && prior.length < BASELINE_DAYS; j--) {
      const d = history[j]!;
      const v = d[s];
      if (!d.unusual && v !== null) prior.push(v);
    }
    const b = baseline(prior, s);
    if (!b) continue;
    const dev = value - b.median;
    const z = (TWO_SIDED.has(s) ? Math.abs(dev) : dev) / b.scale;
    readings.push({ series: s, value, baseline: b, z });
  }
  return { date: day.date, readings, flagged: readings.filter((r) => r.z >= FLAG_Z).map((r) => r.series) };
}

export interface SignalDecision {
  date: string;
  alert: boolean;
  rule?: "two-series" | "two-days" | "one-series";
  reading: DayReading;
}

export type SignalRule = "mantel" | "questions-only";

/**
 * Walk the history and decide, for every day, whether the family is told.
 *
 * mantel: two series flagged the same day, or one series flagged today that
 *   was already at PERSIST_Z the day before. Then COOLDOWN_DAYS of silence.
 * questions-only: the comparison rule from the benchmark, one series, one day.
 */
export function runSignal(history: DayFeatures[], rule: SignalRule = "mantel"): SignalDecision[] {
  const out: SignalDecision[] = [];
  let lastAlert = -Infinity;
  let prev: DayReading | undefined;
  for (let i = 0; i < history.length; i++) {
    const reading = readDay(history, i);
    let fired: SignalDecision["rule"];
    if (rule === "questions-only") {
      if (reading.flagged.includes("questions")) fired = "one-series";
    } else if (reading.flagged.length >= 2) {
      fired = "two-series";
    } else if (reading.flagged.length === 1 && prev) {
      const s = reading.flagged[0]!;
      const before = prev.readings.find((r) => r.series === s);
      if (before && before.z >= PERSIST_Z) fired = "two-days";
    }
    const alert = Boolean(fired) && i - lastAlert > COOLDOWN_DAYS && !history[i]!.unusual;
    if (alert) lastAlert = i;
    out.push({ date: reading.date, alert, ...(alert && fired ? { rule: fired } : {}), reading });
    prev = reading;
  }
  return out;
}

function describe(h: Household, r: SeriesReading): string {
  const usual = r.baseline.median;
  switch (r.series) {
    case "questions":
      return `Asked ${r.value} questions (usually about ${Math.round(usual)}).`;
    case "nightMinutes":
      return `Up for ${Math.round(r.value)} minutes during the night (usually ${Math.round(usual)}).`;
    case "nightDoorOpens":
      return `An outside door opened ${r.value} time${r.value === 1 ? "" : "s"} during the night.`;
    case "firstSeen": {
      // The series is minutes from the planned wake time; the family reads clock times.
      const at = (offset: number) => clockWithPeriod(parseClock(h.settings.wake) + Math.round(offset));
      return `First seen at ${at(r.value)} (usually about ${at(usual)}).`;
    }
  }
}

/** "Sunday, September 27", as the family reads a day. */
function dayName(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${WEEKDAYS[weekdayOf(date)]}, ${longDate(date)}` : date;
}

export function changeAlert(h: Household, decision: SignalDecision, at: Date): Alert {
  const flagged = decision.reading.readings.filter((r) => decision.reading.flagged.includes(r.series) || r.z >= PERSIST_Z);
  return {
    id: `change-${decision.date}`,
    at: at.toISOString(),
    kind: "change",
    urgency: "attention",
    title: `${h.person.name}: a sudden change on ${dayName(decision.date)}`,
    body: [
      ...flagged.map((r) => describe(h, r)),
      `A sudden change can have a medical cause, such as an infection. Consider calling ${h.person.name}'s doctor.`,
    ].join(" "),
  };
}

/** Presence intervals from start/end events, closed at `until` if still open. */
export function presenceIntervals(events: MantelEvent[], until: number): [number, number][] {
  const sorted = events
    .filter((e) => e.type === "presence.start" || e.type === "presence.end")
    .sort((a, b) => a.at.localeCompare(b.at));
  const out: [number, number][] = [];
  let open: number | undefined;
  for (const e of sorted) {
    const t = Date.parse(e.at);
    if (e.type === "presence.start" && open === undefined) open = t;
    if (e.type === "presence.end" && open !== undefined) {
      out.push([open, t]);
      open = undefined;
    }
  }
  if (open !== undefined && until > open) out.push([open, until]);
  return out;
}

function overlapMinutes(intervals: [number, number][], from: number, to: number): number {
  let ms = 0;
  for (const [a, b] of intervals) ms += Math.max(0, Math.min(b, to) - Math.max(a, from));
  return ms / 60_000;
}

/** One care day's features from raw events: `date`'s daytime and the night after it. */
export function dayFeatures(h: Household, events: MantelEvent[], date: string, nowMs: number): DayFeatures {
  const tz = h.settings.timezone;
  const wake = zonedInstant(date, h.settings.wake, tz).getTime();
  const bed = zonedInstant(date, h.settings.bedtime, tz).getTime();
  const nextWake = zonedInstant(addDays(date, 1), h.settings.wake, tz).getTime();
  const nightEnd = nextWake - NIGHT_ENDS_BEFORE_WAKE_MIN * 60_000;
  const dayStart = zonedInstant(date, "04:00", tz).getTime();
  const inRange = (e: MantelEvent, a: number, b: number) => {
    const t = Date.parse(e.at);
    return t >= a && t < b;
  };
  const questions = events.filter((e) => e.type === "question" && inRange(e, dayStart, bed)).length;
  const intervals = presenceIntervals(events, Math.min(nowMs, nightEnd));
  const nightMinutes = Math.round(overlapMinutes(intervals, bed, nightEnd));
  const nightDoorOpens = events.filter((e) => e.type === "contact.open" && inRange(e, bed, nightEnd)).length;
  const firstStart = events
    .filter((e) => e.type === "presence.start" && inRange(e, dayStart, bed))
    .map((e) => Date.parse(e.at))
    .sort((a, b) => a - b)[0];
  const firstSeen = firstStart === undefined ? null : Math.round((firstStart - wake) / 60_000);
  return {
    date,
    questions,
    nightMinutes,
    nightDoorOpens,
    firstSeen,
    ...(h.unusualDays.includes(date) ? { unusual: true } : {}),
  };
}

/** "7:42", the first-seen time as a clock face, for the digest. */
export function firstSeenClock(h: Household, f: DayFeatures): string | undefined {
  if (f.firstSeen === null) return undefined;
  return clockFace(parseClock(h.settings.wake) + f.firstSeen);
}

