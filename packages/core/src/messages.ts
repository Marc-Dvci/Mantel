/**
 * When a family message plays.
 *
 * A message plays once, only when the person is in the room, only after a
 * primary caregiver approved it, and never at night.
 */

import type { Household, Message } from "./model";
import { screenMode } from "./today";
import { localParts, parseClock } from "./time";

export function messageDue(h: Household, m: Message, now: Date | number, present: boolean): boolean {
  if (!m.approvedBy || m.playedAt || !present) return false;
  const p = localParts(now, h.settings.timezone);
  if (m.schedule.date !== p.date) return false;
  if (screenMode(h, p.minuteOfDay) === "night") return false;
  switch (m.schedule.kind) {
    case "first-seen-after":
    case "at":
      return p.minuteOfDay >= parseClock(m.schedule.time);
    case "evening-end":
      return p.minuteOfDay >= parseClock(h.settings.evening.end);
  }
}

/** The first due message, oldest schedule first. */
export function nextMessage(h: Household, now: Date | number, present: boolean): Message | undefined {
  const order = (m: Message) =>
    m.schedule.kind === "evening-end" ? parseClock(h.settings.evening.end) : parseClock(m.schedule.time);
  return h.messages.filter((m) => messageDue(h, m, now, present)).sort((a, b) => order(a) - order(b))[0];
}
