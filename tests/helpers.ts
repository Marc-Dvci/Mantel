import { demoHousehold, zonedInstant, type Household } from "../packages/core/src";

/** Tuesday 29 September 2026 in the demo household's zone. */
export const DAY = "2026-09-29";

export function at(hhmm: string, date = DAY): Date {
  return zonedInstant(date, hhmm, "America/New_York");
}

export function household(hhmm = "15:58", date = DAY): { h: Household; now: Date } {
  const now = at(hhmm, date);
  return { h: demoHousehold(now), now };
}
