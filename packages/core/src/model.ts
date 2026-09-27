/**
 * The household record.
 *
 * One household has one person Mantel serves and a circle of family members.
 * Everything the TV says comes from this record, and every piece of it that
 * carries words has an author and an approval.
 */

export type Role = "primary" | "family" | "aide";

export interface Member {
  id: string;
  name: string;
  /** How the person knows them: "your daughter", "your grandson". */
  relation: string;
  role: Role;
  photo?: string; // media id
  /** Other names the person uses for them ("Sally", "the girl"). */
  aliases?: string[];
}

export interface Person {
  name: string;
  /** Names of people who matter to the person but are not members (Robert, 2022). */
  others: { name: string; relation?: string; aliases?: string[]; photo?: string }[];
}

export type ListeningMode = "questions" | "name" | "off";

export interface Settings {
  timezone: string;
  locale: string;
  wake: string; // "07:00"
  bedtime: string; // "21:30"
  evening: { start: string; end: string };
  listening: ListeningMode;
  /** Minutes before and after a visit's time during which the doorbell counts as that visit. */
  visitWindowMinutes: number;
  /** Seconds an answer stays on screen. */
  answerSeconds: number;
  nightAlerts: { doorOpen: boolean; presence: boolean };
  /** The street name shown in the "where am I" answer and nothing else. */
  homeLine?: string;
  /** Replaces the default night-time lines ("Everyone is asleep."). */
  nightLines?: string[];
}

export type PlanKind = "visit" | "meal" | "pills" | "outing" | "call" | "delivery" | "other";

export interface PlanItem {
  id: string;
  date: string; // YYYY-MM-DD, household-local
  time: string; // HH:MM
  /** For a delivery: the end of its window. */
  until?: string;
  kind: PlanKind;
  /** What the TV shows: "Sarah is coming", "Lunch", "Your walk with Anna". */
  title: string;
  who?: string; // member id
  doneAt?: string; // ISO instant
  doneBy?: string; // member id
}

export type TruthPolicy = "tell" | "redirect" | "comfort";

/**
 * A built-in topic answers from the plan and the clock. A family topic answers
 * with words a member wrote.
 */
export type Builtin = "day" | "time" | "next" | "visitors" | "visit-of" | "meal" | "pills" | "where";

export interface Topic {
  id: string;
  label: string;
  /** Example questions. The matcher learns the topic's vocabulary from these. */
  phrasings: string[];
  builtin?: Builtin;
  /** For builtin "visit-of": the member the topic is about. */
  about?: string;
  /** Names that must appear for this topic to match (Robert, Sarah). Filled from `about` and the answer. */
  entities?: string[];
  /** Accept a statement ("I want to go home") as well as a question. */
  statements?: boolean;
  policy: TruthPolicy;
  answer: string;
  /** A member's recording of `answer`. */
  audio?: string; // media id
  /** Shown beside the answer. */
  photo?: string; // media id
  /** After this instant the answer falls back to `fallback`. */
  expiresAt?: string;
  fallback: string;
  author: string; // member id
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface Moment {
  id: string;
  photo: string; // media id
  caption: string;
  story?: { text: string; audio?: string; by: string };
  year?: string;
  people: string[];
  calm: boolean;
  uploadedBy: string;
  approvedBy?: string;
  approvedAt?: string;
}

export type MessageSchedule =
  | { kind: "first-seen-after"; date: string; time: string }
  | { kind: "at"; date: string; time: string }
  | { kind: "evening-end"; date: string };

export interface Message {
  id: string;
  from: string; // member id
  media: string; // media id, video or audio
  mediaKind: "video" | "audio";
  text: string; // what the message says, shown as a caption
  schedule: MessageSchedule;
  approvedBy?: string;
  approvedAt?: string;
  playedAt?: string;
}

export interface Household {
  id: string;
  name: string;
  person: Person;
  members: Member[];
  settings: Settings;
  plan: PlanItem[];
  topics: Topic[];
  moments: Moment[];
  messages: Message[];
  /** Local dates the family marked as unusual (hospital, holiday). The change signal skips them. */
  unusualDays: string[];
}

export type EventType =
  | "presence.start"
  | "presence.end"
  | "question"
  | "moment.shown"
  | "story.played"
  | "message.played"
  | "door.press"
  | "door.motion"
  | "contact.open"
  | "contact.close"
  | "screen.mode";

export interface MantelEvent {
  id: string;
  at: string; // ISO instant
  type: EventType;
  data?: Record<string, unknown>;
}

export interface QuestionData {
  text: string;
  topicId: string | null;
  score: number;
}

export type DoorKind = "expected-visit" | "expected-delivery" | "unexpected" | "night";

export interface DoorCard {
  id: string;
  at: string;
  kind: DoorKind;
  lines: string[];
  speech: string;
  visitor?: string; // member id
  snapshot?: string; // media id
  expiresAt: string;
}

export type AlertKind = "door.unexpected" | "door.night" | "night.door-open" | "night.presence" | "change" | "door.expected";

export interface Alert {
  id: string;
  at: string;
  kind: AlertKind;
  urgency: "info" | "attention" | "urgent";
  title: string;
  body: string;
  snapshot?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
}

export function memberById(h: Household, id: string | undefined): Member | undefined {
  return id ? h.members.find((m) => m.id === id) : undefined;
}

export function primaryOf(h: Household): Member {
  const p = h.members.find((m) => m.role === "primary");
  if (!p) throw new Error("A household needs a primary caregiver");
  return p;
}

export function isApproved(x: { approvedBy?: string }): boolean {
  return Boolean(x.approvedBy);
}
