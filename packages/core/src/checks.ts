/**
 * Checks on words a model drafted.
 *
 * A model drafts two things in Mantel: photo captions, and a calmer wording of
 * an answer a family member typed. Neither reaches the family without passing
 * here, and neither reaches the TV until a family member approves it.
 *
 * A draft fails if it introduces a name or a number its inputs did not contain,
 * runs too long, or uses words the product never says.
 */

import { normalize, numbersIn } from "./text";

export interface DraftCheck {
  ok: boolean;
  problems: string[];
}

const DEATH_WORDS = [/\bdied\b/i, /\bdead\b/i, /passed away/i, /\bdeath\b/i, /\bfuneral\b/i, /\bgrave\b/i];

const COMMON_CAPITALS = new Set([
  "I", "The", "A", "An", "This", "That", "It", "You", "Your", "He", "She", "They", "We", "There", "Here",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
  "Mantel", "Today", "Yesterday", "Tonight", "Yes", "No", "Next", "Nobody", "Everyone", "Lunch", "Dinner", "Breakfast",
  "Pills", "Asked", "First", "Last", "Up", "Nothing", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Most", "Questions", "Doorbell", "Door", "Messages", "Message", "Moments", "Photos", "Stories", "At", "In", "On", "After", "Before",
  "Her", "His", "Their", "Also", "Otherwise", "Overall", "All", "Some", "Both", "No-one", "Several", "Many", "Few", "Shall",
]);

/**
 * Capitalised words outside a small list of common ones: the draft's proper
 * names. Conservative on purpose: a sentence-initial word the list does not
 * know counts as a name, and an unknown name fails the draft, which then falls
 * back to the deterministic template.
 */
export function namesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b([A-Z][a-z]+)(?:'s)?\b/g)) {
    const word = m[1]!;
    if (!COMMON_CAPITALS.has(word)) out.push(word);
  }
  return out;
}

export interface DraftRules {
  allowedNames: string[];
  allowedNumbers: string[];
  maxChars: number;
  maxSentences?: number;
  allowDeathWords?: boolean;
}

export function checkDraft(draft: string, rules: DraftRules): DraftCheck {
  const problems: string[] = [];
  const text = draft.trim();
  if (!text) problems.push("empty");
  if (text.length > rules.maxChars) problems.push(`longer than ${rules.maxChars} characters`);
  if (rules.maxSentences) {
    const n = text.split(/[.!?]+\s*/).filter(Boolean).length;
    if (n > rules.maxSentences) problems.push(`more than ${rules.maxSentences} sentences`);
  }
  const allowedNames = new Set(rules.allowedNames.flatMap((n) => normalize(n).split(" ")));
  for (const name of namesIn(text)) {
    if (!allowedNames.has(normalize(name))) problems.push(`introduces the name "${name}"`);
  }
  const allowedNumbers = new Set(rules.allowedNumbers);
  for (const n of numbersIn(text)) {
    if (!allowedNumbers.has(n) && !allowedNumbers.has(String(Number(n)))) problems.push(`introduces the number ${n}`);
  }
  if (!rules.allowDeathWords) for (const re of DEATH_WORDS) if (re.test(text)) problems.push(`uses "${re.source.replace(/\\b/g, "")}"`);
  return { ok: problems.length === 0, problems };
}
