/**
 * The evening digest: one care day, as counts.
 *
 * The facts are computed and the sentences are a fixed template over them.
 * No model writes the digest: a caregiver reads it to decide whether to call a
 * doctor, and every number in it must be one they can check.
 */

import type { Household, MantelEvent } from "./model";
import { memberById } from "./model";
import { dayFeatures, presenceIntervals, type DayFeatures } from "./signal";
import { clockWithPeriod, localParts, parseClock, zonedInstant } from "./time";

export interface DigestFacts {
  date: string;
  person: string;
  firstSeen?: string;
  lastSeen?: string;
  questions: number;
  questionsUsual?: number;
  topics: { label: string; count: number }[];
  unanswered: { text: string; count: number }[];
  momentsShown: number;
  storiesPlayed: number;
  messagesPlayed: { from: string }[];
  door: { at: string; kind: string }[];
  nightMinutes: number;
  nightDoorOpens: number;
}

export interface Digest {
  facts: DigestFacts;
  prose: string;
}

export function digestFacts(
  h: Household,
  events: MantelEvent[],
  date: string,
  nowMs: number,
  usual?: { questions?: number },
): DigestFacts {
  const tz = h.settings.timezone;
  const onDate = events.filter((e) => localParts(new Date(e.at), tz).date === date);
  const f: DayFeatures = dayFeatures(h, events, date, nowMs);
  const topicCounts = new Map<string, number>();
  const unknown = new Map<string, { text: string; count: number }>();
  for (const e of onDate.filter((x) => x.type === "question")) {
    const topicId = (e.data?.topicId as string | null | undefined) ?? null;
    if (topicId) topicCounts.set(topicId, (topicCounts.get(topicId) ?? 0) + 1);
    else {
      const text = String(e.data?.text ?? "").trim();
      const key = text.toLowerCase().replace(/[^a-z ]/g, "");
      const u = unknown.get(key) ?? { text, count: 0 };
      u.count++;
      unknown.set(key, u);
    }
  }
  const topics = [...topicCounts.entries()]
    .map(([id, count]) => ({ label: h.topics.find((t) => t.id === id)?.label ?? id, count }))
    .sort((a, b) => b.count - a.count);
  const bed = zonedInstant(date, h.settings.bedtime, tz).getTime();
  const intervals = presenceIntervals(events, Math.min(nowMs, bed)).filter(([a]) => localParts(a, tz).date === date);
  const lastEnd = intervals.at(-1)?.[1];
  const firstSeen = f.firstSeen === null ? undefined : clockWithPeriod(parseClock(h.settings.wake) + f.firstSeen);
  return {
    date,
    person: h.person.name,
    ...(firstSeen ? { firstSeen } : {}),
    ...(lastEnd ? { lastSeen: clockWithPeriod(localParts(lastEnd, tz).minuteOfDay) } : {}),
    questions: f.questions ?? 0,
    ...(usual?.questions !== undefined ? { questionsUsual: Math.round(usual.questions) } : {}),
    topics,
    unanswered: [...unknown.values()].sort((a, b) => b.count - a.count),
    momentsShown: onDate.filter((e) => e.type === "moment.shown").length,
    storiesPlayed: onDate.filter((e) => e.type === "story.played").length,
    messagesPlayed: onDate
      .filter((e) => e.type === "message.played")
      .map((e) => ({ from: memberById(h, e.data?.from as string)?.name ?? "family" })),
    door: onDate
      .filter((e) => e.type === "door.press")
      .map((e) => ({ at: clockWithPeriod(localParts(new Date(e.at), tz).minuteOfDay), kind: String(e.data?.kind ?? "unexpected") })),
    nightMinutes: f.nightMinutes ?? 0,
    nightDoorOpens: f.nightDoorOpens ?? 0,
  };
}

const DOOR_WORDS: Record<string, string> = {
  "expected-visit": "an expected visit",
  "expected-delivery": "a delivery",
  unexpected: "nobody expected",
  night: "at night",
};

export function digestProse(f: DigestFacts): string {
  const out: string[] = [];
  if (f.firstSeen) out.push(`${f.person} was first seen at ${f.firstSeen}${f.lastSeen ? ` and last seen at ${f.lastSeen}` : ""}.`);
  else out.push(`${f.person} was not seen by the TV today.`);
  const usual = f.questionsUsual !== undefined ? ` (usually about ${f.questionsUsual})` : "";
  if (f.questions === 0) out.push("No questions today.");
  else {
    const top = f.topics.slice(0, 3).map((t) => `${t.label} ${t.count}`).join(", ");
    out.push(`${f.questions} question${f.questions === 1 ? "" : "s"}${usual}${top ? `. Most asked: ${top}` : ""}.`);
  }
  if (f.unanswered.length) {
    const list = f.unanswered.slice(0, 3).map((u) => `"${u.text}"${u.count > 1 ? ` ${u.count} times` : ""}`).join(", ");
    out.push(`No answer yet for ${list}. You can add one in Answers.`);
  }
  const moments = [
    f.momentsShown ? `${f.momentsShown} photo${f.momentsShown === 1 ? "" : "s"} shown` : "",
    f.storiesPlayed ? `${f.storiesPlayed} stor${f.storiesPlayed === 1 ? "y" : "ies"} played` : "",
    f.messagesPlayed.length ? `messages from ${[...new Set(f.messagesPlayed.map((m) => m.from))].join(" and ")}` : "",
  ].filter(Boolean);
  if (moments.length) out.push(`${moments.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()));
  if (f.door.length) out.push(`Doorbell: ${f.door.map((d) => `${d.at}, ${DOOR_WORDS[d.kind] ?? d.kind}`).join("; ")}.`);
  if (f.nightMinutes || f.nightDoorOpens) {
    out.push(
      `Last night: ${f.nightMinutes} minutes up${f.nightDoorOpens ? `, an outside door opened ${f.nightDoorOpens} time${f.nightDoorOpens === 1 ? "" : "s"}` : ""}.`,
    );
  }
  return out.join(" ");
}

export function makeDigest(f: DigestFacts): Digest {
  return { facts: f, prose: digestProse(f) };
}
