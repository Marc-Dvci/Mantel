/**
 * Kind Answers: from a spoken sentence to the family's answer.
 *
 * Deterministic end to end. The matcher scores a transcript against each
 * topic's example questions with IDF-weighted token overlap, and three rules
 * sit above the score:
 *
 * 1. **Names gate topics.** A sentence that names a person can only be answered
 *    by a topic about that person, and a sentence that names nobody can never be
 *    answered by a topic about somebody. "Where is Robert?" with no Robert topic
 *    is unknown; it is never answered by "where am I".
 * 2. **Ambiguity is unknown.** The best topic must clear a threshold and beat
 *    the runner-up by a margin.
 * 3. **Unknown is safe.** An unknown sentence brings the Today screen forward
 *    and is saved for the family, who can add an answer.
 *
 * Nothing here calls a model. The words the TV says were written or approved by
 * a family member, or are computed from the plan and the clock.
 */

import type { Household, Member, PlanItem, Topic } from "./model";
import { memberById } from "./model";
import { itemsOn } from "./today";
import { normalize, sameName, tokens } from "./text";
import {
  WEEKDAYS,
  addDays,
  clockFace,
  localParts,
  longDate,
  parseClock,
  partOfDay,
  relativeDay,
  spokenDate,
  spokenTime,
  spokenTimeWords,
} from "./time";

/** Thresholds, fixed before the held-out question set was read. See docs/EVAL.md. */
export const MATCH_THRESHOLD = 0.5;
export const MATCH_MARGIN = 0.08;

const QUESTION_STARTERS = new Set([
  "what", "when", "where", "who", "why", "how", "which",
  "is", "are", "am", "did", "do", "does", "have", "has", "had",
  "can", "could", "will", "would", "should", "was", "were", "shall",
]);

const WH = new Set(["what", "when", "where", "who", "why", "how", "which"]);

const PRONOUNS = new Set(["he", "she", "him", "her", "his", "hers"]);

const STOP = new Set([
  "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "it", "to", "of", "in", "on", "at",
  "i", "me", "my", "you", "your", "we", "us", "our", "he", "she", "him", "her", "his", "they", "them",
  "do", "does", "did", "will", "would", "can", "could", "should", "shall", "have", "has", "had",
  "please", "tell", "know", "just", "now", "oh", "um", "uh", "er", "hmm", "so", "well", "dear", "love",
  "and", "or", "that", "this", "there", "here", "going", "gonna", "get", "got", "still", "yet", "again",
  "mantel", "hey", "hello", "then", "for", "with", "not",
]);

/** Words that mean the same thing to this product. */
const CANON: Record<string, string> = {
  mom: "mother", mum: "mother", mommy: "mother", mummy: "mother", mama: "mother",
  dad: "father", daddy: "father", papa: "father",
  coming: "come", comes: "come", came: "come", arrive: "come", arriving: "come", arrives: "come",
  visiting: "visit", visits: "visit", visited: "visit", visitor: "visit", visitors: "visit",
  eaten: "eat", ate: "eat", eating: "eat", eats: "eat", fed: "feed", feeding: "feed",
  pills: "pill", tablets: "pill", tablet: "pill", medicine: "pill", medicines: "pill",
  medication: "pill", medications: "pill", meds: "pill",
  house: "home", place: "home",
  kids: "children", grandkids: "grandchildren",
  today: "today", tonight: "tonight",
  clock: "time", oclock: "time", hour: "time",
  date: "date", day: "day", days: "day", month: "month", year: "year",
  lunch: "lunch", dinner: "dinner", supper: "dinner", breakfast: "breakfast", tea: "dinner",
  husband: "husband", wife: "wife", hubby: "husband",
  leave: "go", leaving: "go", going: "go", went: "go",
  seeing: "see", saw: "see", seen: "see",
  someone: "someone", somebody: "someone", anyone: "someone", anybody: "someone",
  rung: "call", rang: "call", ring: "call", phoned: "call", phone: "call", called: "call", calling: "call", calls: "call",
  handbag: "purse", pocketbook: "purse",
  monday: "weekday", tuesday: "weekday", wednesday: "weekday", thursday: "weekday", friday: "weekday", saturday: "weekday", sunday: "weekday",
  january: "month", february: "month", march: "month", april: "month", june: "month", july: "month",
  august: "month", september: "month", october: "month", november: "month", december: "month",
  happening: "happen", happens: "happen", next: "next", later: "next", plan: "plan", plans: "plan",
};

function stem(t: string): string {
  const c = CANON[t];
  if (c) return c;
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export interface EntityIndex {
  /** Name token (lowercase) to entity key. */
  names: Map<string, string>;
  /** Relation word ("daughter", "husband") to entity key. */
  relations: Map<string, string>;
}

/** Entity keys are member ids, or "other:<name>" for people who are not members. */
export function entityIndex(h: Household): EntityIndex {
  const names = new Map<string, string>();
  const relations = new Map<string, string>();
  const addName = (n: string, key: string) => {
    for (const t of tokens(n)) if (t.length >= 3) names.set(t, key);
  };
  const addRelation = (rel: string | undefined, key: string) => {
    if (!rel) return;
    for (const t of tokens(rel)) if (!STOP.has(t) && t.length >= 3) relations.set(stem(t), key);
  };
  for (const m of h.members) {
    addName(m.name, m.id);
    for (const a of m.aliases ?? []) addName(a, m.id);
    addRelation(m.relation, m.id);
  }
  for (const o of h.person.others) {
    const key = `other:${normalize(o.name)}`;
    addName(o.name, key);
    for (const a of o.aliases ?? []) addName(a, key);
    addRelation(o.relation, key);
  }
  return { names, relations };
}

export function entitiesIn(text: string, idx: EntityIndex): Set<string> {
  const found = new Set<string>();
  for (const t of tokens(text)) {
    for (const [name, key] of idx.names) if (sameName(t, name)) found.add(key);
    const rel = idx.relations.get(stem(t));
    if (rel) found.add(rel);
  }
  return found;
}

/** The entities a topic is about: explicit ones plus the member a builtin names. */
export function topicEntities(h: Household, topic: Topic, idx: EntityIndex): Set<string> {
  const out = new Set<string>();
  if (topic.about) out.add(topic.about);
  for (const e of topic.entities ?? []) {
    if (h.members.some((m) => m.id === e) || e.startsWith("other:")) out.add(e);
    else for (const k of entitiesIn(e, idx)) out.add(k);
  }
  return out;
}

export function isQuestion(text: string): boolean {
  if (/\?\s*$/.test(text.trim())) return true;
  const t = tokens(text).filter((w) => !["mantel", "hey", "oh", "um", "uh", "so", "well", "and", "but", "dear"].includes(w));
  if (!t.length) return false;
  if (QUESTION_STARTERS.has(t[0]!)) return true;
  const n = t.join(" ");
  return /\b(tell me|i want to know|do you know|i wonder)\b/.test(n) || /\b(what|when|where|who)\b/.test(n);
}

/** Should this utterance be considered at all, under the household's listening mode? */
export function addressed(text: string, mode: Household["settings"]["listening"]): boolean {
  if (mode === "off") return false;
  if (mode === "name") return /\bmant[ae]l\b/.test(normalize(text));
  return true;
}

/** Two-word phrases that mean one thing: "get here" is "come". */
const PHRASES: [RegExp, string][] = [
  [/\bget here\b/g, "come"],
  [/\bgets here\b/g, "come"],
  [/\bcome over\b/g, "come"],
  [/\bcoming over\b/g, "come"],
  [/\bcome round\b/g, "come"],
  [/\bcoming round\b/g, "come"],
  [/\bpop in\b/g, "come"],
];

function contentTokens(text: string): string[] {
  let n = normalize(text);
  for (const [re, rep] of PHRASES) n = n.replace(re, rep);
  return n.split(" ").filter((t) => t && !STOP.has(t) && !WH.has(t)).map(stem);
}

/** Words dropped before comparing a whole sentence with a whole example question. */
const FILLERS = new Set(["mantel", "hey", "oh", "um", "uh", "er", "hmm", "so", "well", "dear", "love", "please", "now", "then", "and", "but", "just"]);

const DETERMINERS = new Set(["my", "your", "the", "a", "our"]);

export type MatchResult =
  | { kind: "answer"; topic: Topic; score: number; runnerUp: number }
  | {
      kind: "unknown";
      reason: "no-match" | "ambiguous" | "not-a-question" | "unknown-person" | "empty";
      best?: { topicId: string; score: number };
    };

interface Phrasing {
  key: string;
  toks: string[];
  wh: string | undefined;
}

interface Prepared {
  topic: Topic;
  entities: Set<string>;
  phrasings: Phrasing[];
}

/** A statement ("I want to see Robert") must share this many content words with an example. */
const STATEMENT_MIN_SHARED = 2;
/** Word overlap never scores as high as a whole-sentence match. */
const OVERLAP_CAP = 0.9;
/**
 * A question that names a person, and matches nothing on its words, is
 * answered by that person's redirect or comfort topic when there is exactly
 * one. Those topics are the family's answer to any question about the person
 * ("Robert loved this house..."). A "tell" topic always needs matching words.
 */
const PERSON_CATCH_ALL_SCORE = 0.6;

export class Matcher {
  private readonly idx: EntityIndex;
  private readonly prepared: Prepared[];
  private readonly idf = new Map<string, number>();

  constructor(private readonly h: Household, topics: Topic[] = h.topics.filter((t) => t.approvedBy)) {
    this.idx = entityIndex(h);
    this.prepared = topics.map((topic) => ({
      topic,
      entities: topicEntities(h, topic, this.idx),
      phrasings: topic.phrasings.map((p) => ({
        key: this.phraseKey(p),
        toks: [...new Set(this.withoutNames(contentTokens(p)))],
        wh: tokens(p).find((w) => WH.has(w)),
      })),
    }));
    // Document frequency is counted per topic, so a topic with many phrasings
    // does not make its own words look common.
    const df = new Map<string, number>();
    for (const p of this.prepared) {
      const seen = new Set(p.phrasings.flatMap((x) => x.toks));
      for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const n = Math.max(1, this.prepared.length);
    for (const [t, d] of df) this.idf.set(t, Math.log(1 + n / d));
  }

  /**
   * The sentence as a comparison key: fillers and determiners dropped, every
   * name or relation replaced by one placeholder. "Where's my daughter?" and
   * the example "where is sarah" share the key "where is @p".
   */
  private phraseKey(text: string): string {
    return tokens(text)
      .filter((t) => !FILLERS.has(t) && !DETERMINERS.has(t))
      .map((t) => ([...this.idx.names.keys()].some((n) => sameName(t, n)) || this.idx.relations.has(stem(t)) ? "@p" : t))
      .join(" ");
  }

  /** Names are handled by the entity gate, so they do not also count as overlap. */
  private withoutNames(toks: string[]): string[] {
    return toks.filter((t) => ![...this.idx.names.keys()].some((n) => sameName(t, n)) && !this.idx.relations.has(t));
  }

  private weight(t: string): number {
    return this.idf.get(t) ?? Math.log(1 + Math.max(1, this.prepared.length));
  }

  /**
   * Cosine similarity of IDF-weighted content words, halved when the two ask
   * with different wh-words ("where" against "when"). A whole-sentence match
   * with an example scores 1, which is how short questions made only of
   * function words ("where am I") are recognised at all.
   */
  private similarity(u: string[], uKey: string, uWh: string | undefined, p: Phrasing, statement: boolean): number {
    if (uKey && uKey === p.key) return 1;
    if (!u.length || !p.toks.length) return 0;
    const pset = new Set(p.toks);
    let shared = 0;
    let sharedCount = 0;
    for (const t of u) {
      if (pset.has(t)) {
        shared += this.weight(t) ** 2;
        sharedCount++;
      }
    }
    if (statement && sharedCount < STATEMENT_MIN_SHARED) return 0;
    const nu = Math.sqrt(u.reduce((s, t) => s + this.weight(t) ** 2, 0));
    const np = Math.sqrt(p.toks.reduce((s, t) => s + this.weight(t) ** 2, 0));
    let score = Math.min(OVERLAP_CAP, shared / (nu * np));
    if (uWh && p.wh && uWh !== p.wh) score *= 0.5;
    return score;
  }

  match(text: string): MatchResult {
    const raw = tokens(text);
    if (!raw.length) return { kind: "unknown", reason: "empty" };
    const utterEntities = entitiesIn(text, this.idx);
    const question = isQuestion(text);
    const u = [...new Set(this.withoutNames(contentTokens(text)))];
    const uWh = raw.find((w) => WH.has(w));
    const uKey = this.phraseKey(text);
    // "When is she coming?" is about a person Mantel cannot identify.
    if (utterEntities.size === 0 && raw.some((w) => PRONOUNS.has(w))) return { kind: "unknown", reason: "unknown-person" };

    const candidates = this.prepared.filter((p) => {
      if (!question && !p.topic.statements) return false;
      if (utterEntities.size === 0) return p.entities.size === 0;
      return [...p.entities].some((e) => utterEntities.has(e));
    });
    if (!candidates.length) {
      if (utterEntities.size > 0) return { kind: "unknown", reason: "unknown-person" };
      return { kind: "unknown", reason: question ? "no-match" : "not-a-question" };
    }

    const scored = candidates
      .map((p) => ({ p, score: Math.max(0, ...p.phrasings.map((ph) => this.similarity(u, uKey, uWh, ph, !question))) }))
      .sort((a, b) => b.score - a.score);
    if (question && utterEntities.size > 0 && scored[0]!.score < MATCH_THRESHOLD) {
      const catchAll = candidates.filter((p) => p.topic.policy !== "tell" && !p.topic.builtin);
      if (catchAll.length === 1) {
        return { kind: "answer", topic: catchAll[0]!.topic, score: PERSON_CATCH_ALL_SCORE, runnerUp: scored[0]!.score };
      }
    }
    const best = scored[0]!;
    const runnerUp = scored[1]?.score ?? 0;
    if (best.score < MATCH_THRESHOLD) {
      return { kind: "unknown", reason: question ? "no-match" : "not-a-question", best: { topicId: best.p.topic.id, score: best.score } };
    }
    if (best.score - runnerUp < MATCH_MARGIN) {
      return { kind: "unknown", reason: "ambiguous", best: { topicId: best.p.topic.id, score: best.score } };
    }
    return { kind: "answer", topic: best.p.topic, score: best.score, runnerUp };
  }
}

export interface Answer {
  topicId: string;
  text: string;
  speech: string;
  audio?: string;
  photo?: string;
  /** "Sarah, this morning" / "From today's plan". */
  attribution: string;
  source: "family" | "plan" | "clock" | "fallback";
}

/** "this morning", "yesterday", "on Monday", "on September 12". */
export function whenWritten(h: Household, iso: string, now: Date | number): string {
  const tz = h.settings.timezone;
  const then = localParts(new Date(iso), tz);
  const today = localParts(now, tz);
  if (then.date === today.date) {
    const pod = partOfDay(then.minuteOfDay);
    return pod === "night" ? "last night" : `this ${pod}`;
  }
  if (then.date === addDays(today.date, -1)) return "yesterday";
  for (let i = 2; i <= 6; i++) if (then.date === addDays(today.date, -i)) return `on ${WEEKDAYS[then.weekday]}`;
  return `on ${longDate(then.date)}`;
}

function familyAttribution(h: Household, t: Topic, now: Date | number): string {
  const who = memberById(h, t.author);
  return who ? `${who.name}, ${whenWritten(h, t.updatedAt, now)}` : "Your family";
}

function nextVisitOf(h: Household, member: Member, today: string, minuteOfDay: number): PlanItem | undefined {
  for (let d = 0; d <= 14; d++) {
    const date = addDays(today, d);
    const visit = itemsOn(h, date).find(
      (i) =>
        i.kind === "visit" &&
        i.who === member.id &&
        !i.doneAt &&
        (d > 0 || parseClock(i.time) + h.settings.visitWindowMinutes > minuteOfDay),
    );
    if (visit) return visit;
  }
  return undefined;
}

/** Resolve the words for a matched topic, now. */
export function resolveAnswer(h: Household, topic: Topic, now: Date | number): Answer {
  const tz = h.settings.timezone;
  const p = localParts(now, tz);
  const expired = topic.expiresAt ? new Date(topic.expiresAt).getTime() <= (typeof now === "number" ? now : now.getTime()) : false;
  const base = { topicId: topic.id, ...(topic.photo ? { photo: topic.photo } : {}) };
  const fallback = (): Answer => ({ ...base, text: topic.fallback, speech: topic.fallback, attribution: familyAttribution(h, topic, now), source: "fallback" });
  const plan = (text: string, speech = text): Answer => ({ ...base, text, speech, attribution: "From today's plan", source: "plan" });

  switch (topic.builtin) {
    case "day": {
      const pod = partOfDay(p.minuteOfDay);
      const dn = WEEKDAYS[p.weekday];
      return {
        ...base,
        text: `It's ${dn} ${pod === "night" ? "night" : pod}, ${longDate(p.date)}.`,
        speech: `It's ${dn} ${pod === "night" ? "night" : pod}, ${spokenDate(p.date)}.`,
        attribution: "Today",
        source: "clock",
      };
    }
    case "time": {
      const pod = partOfDay(p.minuteOfDay);
      const where = pod === "night" ? "at night" : `in the ${pod}`;
      return {
        ...base,
        text: `It's ${clockFace(p.minuteOfDay)} ${where}.`,
        speech: `It's ${spokenTimeWords(p.minuteOfDay)}, ${where}.`,
        attribution: "Today",
        source: "clock",
      };
    }
    case "next": {
      const items = itemsOn(h, p.date).filter((i) => !i.doneAt && parseClock(i.time) + 10 > p.minuteOfDay);
      const first = items[0];
      if (!first) return fallback();
      return plan(`Next: ${first.title} at ${spokenTime(parseClock(first.time))}.`, `Next, ${first.title} at ${spokenTimeWords(parseClock(first.time))}.`);
    }
    case "visitors": {
      const visits = itemsOn(h, p.date).filter((i) => i.kind === "visit" && !i.doneAt && parseClock(i.time) + h.settings.visitWindowMinutes > p.minuteOfDay);
      if (!visits.length) return fallback();
      const lines = visits.map((v) => `${v.title} at ${spokenTime(parseClock(v.time))}`);
      const speech = visits.map((v) => `${v.title} at ${spokenTimeWords(parseClock(v.time))}`);
      const photo = memberById(h, visits[0]!.who)?.photo;
      return { ...plan(`${lines.join(". ")}.`, `${speech.join(". ")}.`), ...(photo ? { photo } : {}) };
    }
    case "visit-of": {
      const member = memberById(h, topic.about);
      if (!member) return fallback();
      const v = nextVisitOf(h, member, p.date, p.minuteOfDay);
      if (!v) return { ...fallback(), ...(member.photo ? { photo: member.photo } : {}) };
      const day = relativeDay(p.date, v.date);
      const t = parseClock(v.time);
      return {
        ...plan(`${member.name} is coming ${day} at ${spokenTime(t)}.`, `${member.name} is coming ${day} at ${spokenTimeWords(t)}.`),
        ...(member.photo ? { photo: member.photo } : {}),
      };
    }
    case "meal": {
      const meals = itemsOn(h, p.date).filter((i) => i.kind === "meal");
      const eaten = meals.filter((m) => m.doneAt).at(-1);
      if (eaten) {
        const when = localParts(new Date(eaten.doneAt!), tz).minuteOfDay;
        return plan(`You had ${eaten.title.toLowerCase()} at ${spokenTime(when)}.`, `You had ${eaten.title.toLowerCase()} at ${spokenTimeWords(when)}.`);
      }
      const upcoming = meals.find((m) => parseClock(m.time) + 10 > p.minuteOfDay);
      if (upcoming) {
        const t = parseClock(upcoming.time);
        return plan(`${upcoming.title} is at ${spokenTime(t)}.`, `${upcoming.title} is at ${spokenTimeWords(t)}.`);
      }
      return fallback();
    }
    case "pills": {
      // Only ever confirms what someone marked as done. It never says pills
      // were missed and never tells the person to take anything.
      const done = itemsOn(h, p.date).filter((i) => i.kind === "pills" && i.doneAt).at(-1);
      if (!done) return fallback();
      const when = localParts(new Date(done.doneAt!), tz).minuteOfDay;
      const by = memberById(h, done.doneBy);
      return plan(
        `Yes. You took your pills at ${spokenTime(when)}${by ? ` with ${by.name}` : ""}.`,
        `Yes. You took your pills at ${spokenTimeWords(when)}${by ? ` with ${by.name}` : ""}.`,
      );
    }
    case "where": {
      if (expired) return fallback();
      return { ...base, text: topic.answer, speech: topic.answer, attribution: familyAttribution(h, topic, now), source: "family" };
    }
    default: {
      if (expired) return fallback();
      return {
        ...base,
        text: topic.answer,
        speech: topic.answer,
        ...(topic.audio ? { audio: topic.audio } : {}),
        attribution: familyAttribution(h, topic, now),
        source: "family",
      };
    }
  }
}

/** The neutral response to a sentence Mantel has no answer for. */
export const UNKNOWN_RESPONSE = {
  text: "Let's look at today together.",
  speech: "Let's look at today together.",
};
