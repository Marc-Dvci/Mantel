/**
 * At the Door: what the TV says when the doorbell rings.
 *
 * The decision uses only what the family planned. Mantel never identifies a
 * caller and never says a caller is dangerous. It says whether a visit or a
 * delivery was expected, and when nothing was, that the person does not need
 * to open the door and that their caregiver can see who is there.
 */

import type { Alert, DoorCard, Household, PlanItem } from "./model";
import { memberById, primaryOf } from "./model";
import { itemsOn, screenMode } from "./today";
import { clockFace, localParts, parseClock, spokenTime, spokenTimeWords } from "./time";

export const DOOR_CARD_SECONDS = 180;

export interface DoorDecision {
  card: DoorCard;
  alert: Alert;
  visit?: PlanItem;
}

function closestVisit(h: Household, date: string, minuteOfDay: number): PlanItem | undefined {
  const w = h.settings.visitWindowMinutes;
  return itemsOn(h, date)
    .filter((i) => i.kind === "visit" && !i.doneAt && Math.abs(parseClock(i.time) - minuteOfDay) <= w)
    .sort((a, b) => Math.abs(parseClock(a.time) - minuteOfDay) - Math.abs(parseClock(b.time) - minuteOfDay))[0];
}

function deliveryNow(h: Household, date: string, minuteOfDay: number): PlanItem | undefined {
  return itemsOn(h, date).find((i) => {
    if (i.kind !== "delivery" || i.doneAt) return false;
    const start = parseClock(i.time);
    const end = i.until ? parseClock(i.until) : start + 240;
    return minuteOfDay >= start && minuteOfDay <= end;
  });
}

export function decideDoor(h: Household, at: Date, id: string, snapshot?: string): DoorDecision {
  const tz = h.settings.timezone;
  const p = localParts(at, tz);
  const primary = primaryOf(h);
  const expiresAt = new Date(at.getTime() + DOOR_CARD_SECONDS * 1000).toISOString();
  const common = { id, at: at.toISOString(), expiresAt, ...(snapshot ? { snapshot } : {}) };
  const clock = clockFace(p.minuteOfDay);
  const alertBase = { id: `alert-${id}`, at: at.toISOString(), ...(snapshot ? { snapshot } : {}) };

  if (screenMode(h, p.minuteOfDay) === "night") {
    const lines = ["Someone rang the doorbell.", "You don't need to open the door.", `${primary.name} has been told.`];
    return {
      card: { ...common, kind: "night", lines, speech: lines.join(" ") },
      alert: {
        ...alertBase,
        kind: "door.night",
        urgency: "urgent",
        title: `Doorbell at ${clock} at night`,
        body: `Nobody is expected. The TV told ${h.person.name} not to open the door. Check the doorbell camera.`,
      },
    };
  }

  const visit = closestVisit(h, p.date, p.minuteOfDay);
  if (visit) {
    const who = memberById(h, visit.who);
    const name = who?.name ?? "your visitor";
    const t = parseClock(visit.time);
    const lines = [`That's probably ${name}.`, `${name} is due at ${spokenTime(t)}.`];
    const speech = `That's probably ${name}. ${name} is due at ${spokenTimeWords(t)}.`;
    return {
      visit,
      card: { ...common, kind: "expected-visit", lines, speech, ...(who ? { visitor: who.id } : {}) },
      alert: {
        ...alertBase,
        kind: "door.expected",
        urgency: "info",
        title: `Doorbell at ${clock}: expected visit`,
        body: `${visit.title} was planned for ${spokenTime(t)}. The TV said it is probably ${name}.`,
      },
    };
  }

  const delivery = deliveryNow(h, p.date, p.minuteOfDay);
  if (delivery) {
    const lines = ["A parcel is coming today.", "The driver will leave it at the door.", "You don't need to open the door."];
    return {
      card: { ...common, kind: "expected-delivery", lines, speech: lines.join(" ") },
      alert: {
        ...alertBase,
        kind: "door.expected",
        urgency: "info",
        title: `Doorbell at ${clock}: delivery window`,
        body: `${delivery.title} was expected. The TV said the driver will leave it at the door.`,
      },
    };
  }

  const lines = ["You're not expecting anyone.", "You don't need to open the door.", `${primary.name} can see who it is.`];
  return {
    card: { ...common, kind: "unexpected", lines, speech: lines.join(" ") },
    alert: {
      ...alertBase,
      kind: "door.unexpected",
      urgency: "attention",
      title: `Doorbell at ${clock}: nobody expected`,
      body: `No visit or delivery was planned. The TV told ${h.person.name} there is no need to open the door.`,
    },
  };
}

/** A contact sensor on an outside door opening while the house sleeps. */
export function nightDoorAlert(h: Household, at: Date, id: string, sensorName: string): Alert | undefined {
  if (!h.settings.nightAlerts.doorOpen) return undefined;
  const p = localParts(at, h.settings.timezone);
  if (screenMode(h, p.minuteOfDay) !== "night") return undefined;
  return {
    id: `alert-${id}`,
    at: at.toISOString(),
    kind: "night.door-open",
    urgency: "urgent",
    title: `${sensorName} opened at ${clockFace(p.minuteOfDay)}`,
    body: `An outside door opened during the night. ${h.person.name} may have gone out.`,
  };
}

/** Presence in the living room at night, for a live-in carer who asked to be told. */
export function nightPresenceAlert(h: Household, at: Date, id: string): Alert | undefined {
  if (!h.settings.nightAlerts.presence) return undefined;
  const p = localParts(at, h.settings.timezone);
  if (screenMode(h, p.minuteOfDay) !== "night") return undefined;
  return {
    id: `alert-${id}`,
    at: at.toISOString(),
    kind: "night.presence",
    urgency: "attention",
    title: `Up at ${clockFace(p.minuteOfDay)}`,
    body: `${h.person.name} is in the living room. The TV is showing the night screen.`,
  };
}
