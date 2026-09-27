/**
 * Topics every household starts with, and guidance for the hard ones.
 *
 * Built-in topics answer from the clock and the plan. Their example questions
 * are editable, their fallback wording is written by the family, and they are
 * approved like any other topic before the TV will use them.
 */

import type { Builtin, Household, Member, Topic, TruthPolicy } from "./model";

interface BuiltinSpec {
  builtin: Builtin;
  label: string;
  phrasings: string[];
  fallback: string;
  statements?: boolean;
}

const BUILTINS: BuiltinSpec[] = [
  {
    builtin: "day",
    label: "What day it is",
    phrasings: [
      "what day is it", "what is the date", "what is today", "what day is today", "is it sunday",
      "what day of the week is it", "what month is it", "what is the date today", "which day is it", "what year is it",
    ],
    fallback: "",
  },
  {
    builtin: "time",
    label: "What time it is",
    phrasings: ["what time is it", "what is the time", "is it morning", "is it late", "is it night", "is it the afternoon"],
    fallback: "",
  },
  {
    builtin: "next",
    label: "What happens next",
    phrasings: [
      "what happens next", "what are we doing today", "what is on today", "what is the plan", "what is happening today",
      "what do i do now", "what am i doing today", "what is next", "what are we doing later",
    ],
    fallback: "Nothing else is planned today. It's a quiet day at home.",
  },
  {
    builtin: "visitors",
    label: "Who is coming",
    phrasings: [
      "who is coming today", "is anyone coming", "is somebody coming", "who is visiting", "are we expecting anyone",
      "is anybody coming today", "who is coming to see me", "am i having visitors",
    ],
    fallback: "Nobody is planned today. It's a quiet day at home.",
  },
  {
    builtin: "meal",
    label: "Meals",
    phrasings: [
      "have i eaten", "did i have lunch", "when is lunch", "when is dinner", "have i had breakfast", "is it time to eat",
      "when do we eat", "did i eat today", "what time is lunch",
    ],
    fallback: "There's food in the kitchen whenever you're hungry.",
  },
  {
    builtin: "pills",
    label: "Pills",
    phrasings: ["did i take my pills", "have i taken my medicine", "do i need my pills", "did i have my tablets", "have i had my pills today"],
    fallback: "Your pills are looked after. Anna helps you with them.",
  },
  {
    builtin: "where",
    label: "Where I am",
    phrasings: ["where am i", "whose house is this", "is this my home", "i want to go home", "take me home", "i need to go home", "where do i live"],
    fallback: "You're at home. You're safe.",
    statements: true,
  },
];

let seq = 0;
const id = (prefix: string) => `${prefix}-${(++seq).toString(36)}`;

export function builtinTopics(h: Pick<Household, "members" | "settings">, author: Member, at: string): Topic[] {
  const out: Topic[] = BUILTINS.map((b) => ({
    id: `builtin-${b.builtin}`,
    label: b.label,
    phrasings: b.phrasings,
    builtin: b.builtin,
    ...(b.statements ? { statements: true } : {}),
    policy: "tell" as TruthPolicy,
    answer: b.builtin === "where" ? `You're at home${h.settings.homeLine ? `, ${h.settings.homeLine}` : ""}. You're safe.` : "",
    fallback: b.fallback,
    author: author.id,
    updatedAt: at,
  }));
  for (const m of h.members.filter((x) => x.role !== "aide")) {
    const n = m.name.toLowerCase();
    out.push({
      id: `visit-${m.id}`,
      label: `When ${m.name} is coming`,
      phrasings: [
        `when is ${n} coming`, `is ${n} coming today`, `when will i see ${n}`, `where is ${n}`,
        `is ${n} coming`, `when does ${n} come`, `will ${n} visit`, `has ${n} called`, `i want to see ${n}`,
      ],
      builtin: "visit-of",
      about: m.id,
      statements: true,
      policy: "tell",
      answer: "",
      fallback: `${m.name} loves you and will see you soon.`,
      author: author.id,
      updatedAt: at,
    });
  }
  return out;
}

export function newTopicId(): string {
  return id("topic");
}

/**
 * Starting points for the questions families find hardest. Each carries the
 * three truth policies with an example wording; the family picks one and writes
 * their own words. Mantel never chooses a policy.
 */
export interface Guidance {
  key: string;
  title: string;
  example: string;
  why: string;
  options: { policy: TruthPolicy; example: string }[];
  source: string;
}

export const GUIDANCE: Guidance[] = [
  {
    key: "late-spouse",
    title: "Asking for a husband or wife who has died",
    example: "Where is Robert?",
    why: "Hearing the news again can be felt as a new loss each time. Many families answer the feeling behind the question.",
    options: [
      { policy: "comfort", example: "Robert loved you very much. Tell me about the day you met." },
      { policy: "redirect", example: "Robert loved this house. Shall we look at your photos from Lake Tahoe?" },
      { policy: "tell", example: "Robert died two years ago. He loved you very much, and we miss him too." },
    ],
    source: "https://www.alz.org/help-support/caregiving/daily-care/communications",
  },
  {
    key: "go-home",
    title: "Wanting to go home while at home",
    example: "I want to go home.",
    why: "\"Home\" often means a feeling of safety or an earlier time. Arguing that this is home tends to raise distress.",
    options: [
      { policy: "comfort", example: "You're safe here. Tell me about the house you grew up in." },
      { policy: "redirect", example: "You're safe. Let's look at today together." },
      { policy: "tell", example: "You're at home, on Maple Street. You've lived here since 1974. You're safe." },
    ],
    source: "https://www.alz.org/help-support/caregiving/stages-behaviors/wandering",
  },
  {
    key: "parent",
    title: "Asking for a parent",
    example: "When is my mother coming?",
    why: "The question is usually about comfort and belonging. Families often talk about the parent rather than the timing.",
    options: [
      { policy: "comfort", example: "Your mother loved you so much. What was she like?" },
      { policy: "redirect", example: "Let's look at your photos together." },
      { policy: "tell", example: "Your mother passed away a long time ago. She loved you very much." },
    ],
    source: "https://www.alz.org/help-support/caregiving/stages-behaviors/repetition",
  },
  {
    key: "money",
    title: "Worrying about bills and money",
    example: "Have I paid the bills?",
    why: "A steady, factual reassurance works when it is true. Keep it true.",
    options: [
      { policy: "tell", example: "Sarah takes care of the bills. Everything is paid." },
      { policy: "redirect", example: "It's all taken care of. Shall we look at today?" },
      { policy: "comfort", example: "You don't need to worry about that. You're looked after." },
    ],
    source: "https://www.alz.org/help-support/caregiving/stages-behaviors/repetition",
  },
];
