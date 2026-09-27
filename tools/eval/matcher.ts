/**
 * Kind Answers evaluation.
 *
 *   pnpm eval                 dev set, then the held-out set if it exists
 *   pnpm eval --set dev       one set
 *   pnpm eval --json out.json write every row
 *
 * A wrong answer is the failure that matters: answering "When is Sarah
 * coming?" with Robert's topic, or answering TV dialogue at all. An unknown
 * reply is safe, because the TV then shows the Today screen and saves the
 * question for the family. So the table reports wrong answers separately from
 * coverage, and the run fails if any set gives a wrong answer.
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Matcher, demoHousehold, zonedInstant, type MatchResult } from "../../packages/core/src";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "../../fixtures/questions");

interface Row {
  text: string;
  expect: string | null;
}

export interface SetResult {
  set: string;
  n: number;
  answerable: number;
  correct: number;
  wrongTopic: number;
  missed: number;
  unanswerable: number;
  falseAnswers: number;
  rows: { text: string; expect: string | null; got: string | null; reason?: string; score?: number }[];
}

export function load(set: string): Row[] {
  const file = join(DIR, `${set}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
}

export function evaluate(set: string, rows: Row[]): SetResult {
  const now = zonedInstant("2026-09-29", "14:05", "America/New_York");
  const matcher = new Matcher(demoHousehold(now));
  const r: SetResult = { set, n: rows.length, answerable: 0, correct: 0, wrongTopic: 0, missed: 0, unanswerable: 0, falseAnswers: 0, rows: [] };
  for (const row of rows) {
    const m: MatchResult = matcher.match(row.text);
    const got = m.kind === "answer" ? m.topic.id : null;
    if (row.expect) {
      r.answerable++;
      if (got === row.expect) r.correct++;
      else if (got) r.wrongTopic++;
      else r.missed++;
    } else {
      r.unanswerable++;
      if (got) r.falseAnswers++;
    }
    r.rows.push({
      text: row.text,
      expect: row.expect,
      got,
      ...(m.kind === "unknown" ? { reason: m.reason } : {}),
      score: m.kind === "answer" ? Number(m.score.toFixed(3)) : m.best ? Number(m.best.score.toFixed(3)) : 0,
    });
  }
  return r;
}

function pct(a: number, b: number): string {
  return b ? `${((100 * a) / b).toFixed(1)}%` : "n/a";
}

function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--set") ? args[args.indexOf("--set") + 1] : undefined;
  const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
  const sets = (only ? [only] : ["dev", "holdout"]).filter((s) => load(s).length);
  const results = sets.map((s) => evaluate(s, load(s)));
  console.log("set       items  answered right  wrong topic  missed  false answers  wrong answers");
  for (const r of results) {
    const wrong = r.wrongTopic + r.falseAnswers;
    console.log(
      `${r.set.padEnd(9)} ${String(r.n).padStart(5)}  ${`${r.correct}/${r.answerable} ${pct(r.correct, r.answerable)}`.padStart(14)}  ${String(r.wrongTopic).padStart(11)}  ${String(r.missed).padStart(6)}  ${`${r.falseAnswers}/${r.unanswerable}`.padStart(13)}  ${String(wrong).padStart(13)}`,
    );
  }
  if (args.includes("--misses")) {
    for (const r of results) for (const row of r.rows) if (row.got !== row.expect) console.log(`  [${r.set}] "${row.text}" expected ${row.expect} got ${row.got} (${row.reason ?? ""} ${row.score})`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  const wrong = results.reduce((s, r) => s + r.wrongTopic + r.falseAnswers, 0);
  if (wrong > 0) {
    console.error(`\n${wrong} wrong answer(s). An unknown reply is safe; a wrong one is not.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
