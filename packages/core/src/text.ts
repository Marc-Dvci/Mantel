/**
 * Text normalisation shared by the matcher and the draft checks.
 */

const CONTRACTIONS: [RegExp, string][] = [
  [/\bwhat's\b/g, "what is"],
  [/\bwhere's\b/g, "where is"],
  [/\bwhen's\b/g, "when is"],
  [/\bwho's\b/g, "who is"],
  [/\bhow's\b/g, "how is"],
  [/\bthat's\b/g, "that is"],
  [/\bthere's\b/g, "there is"],
  [/\bit's\b/g, "it is"],
  [/\bi'm\b/g, "i am"],
  [/\bcan't\b/g, "can not"],
  [/\bwon't\b/g, "will not"],
  [/\bain't\b/g, "is not"],
  [/n't\b/g, " not"],
  [/'ll\b/g, " will"],
  [/'re\b/g, " are"],
  [/'ve\b/g, " have"],
  [/'d\b/g, " would"],
  [/'s\b/g, ""],
];

/** Lowercase, straight quotes, contractions expanded, punctuation removed. */
export function normalize(text: string): string {
  let s = text.toLowerCase().replace(/[‘’ʼ`]/g, "'");
  for (const [re, rep] of CONTRACTIONS) s = s.replace(re, rep);
  s = s.replace(/o'clock/g, "oclock");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

export function tokens(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

/** Levenshtein distance, capped: returns cap+1 as soon as it is exceeded. */
export function editDistance(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Two words are the same name if equal, or one edit apart when both are at least four letters. */
export function sameName(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return editDistance(a, b, 1) <= 1;
}

/** Every number written in digits in a text ("4", "12:30" gives 12 and 30). */
export function numbersIn(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}
