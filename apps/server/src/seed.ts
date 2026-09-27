/**
 * The demo household, seeded: Margaret's home with forty days of simulated
 * history, three family members with sign-in tokens, a paired TV, and a Ring
 * doorbell and front-door contact sensor.
 */

import { addDays, demoHistory, demoHousehold, localParts } from "../../../packages/core/src";
import type { Mantel } from "./service";
import { SIM_DOORBELL, SIM_FRONT_DOOR } from "./ringsim";
import type { HouseholdState } from "./store";

export const DEMO_HID = "hale";

/** Local sign-in tokens for the demo. Real households pair and sign in; these exist only with MANTEL_DEMO. */
export const DEMO_TOKENS = {
  "demo-sarah": { kind: "member", memberId: "sarah" },
  "demo-tom": { kind: "member", memberId: "tom" },
  "demo-anna": { kind: "member", memberId: "anna" },
  "demo-tv": { kind: "tv", deviceName: "Living room TV" },
} as const;

export async function seedDemo(mantel: Mantel): Promise<void> {
  const { store } = mantel.deps;
  const now = mantel.clock.now();
  const household = demoHousehold(now);
  const { events } = demoHistory(household, now);
  const state: HouseholdState = {
    household,
    version: 1,
    alerts: [],
    digests: {},
    evaluated: [],
    tokens: { ...DEMO_TOKENS },
    pairCodes: [],
    presence: { present: false },
    ringDevices: [
      { id: SIM_DOORBELL, name: "Front Door", kind: "doorbell" },
      { id: SIM_FRONT_DOOR, name: "Front door", kind: "contact", outside: true },
    ],
  };
  await store.put(DEMO_HID, state);
  await store.deleteEvents(DEMO_HID);
  await store.addEvents(DEMO_HID, events);
  const today = localParts(now, household.settings.timezone).date;
  for (let d = 3; d >= 1; d--) await mantel.makeDigest(DEMO_HID, addDays(today, -d));
  await mantel.tick(DEMO_HID);
}
