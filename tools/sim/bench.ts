/**
 * Change Signal benchmark on simulated households.
 *
 *   pnpm bench --dev       seeds 1-40, used while developing the rule
 *   pnpm bench --holdout   seeds 1001-1040, read once against a frozen rule
 *   pnpm bench --json f    also write the numbers
 *
 * Each seed is a household generated twice: with a sudden-change episode and
 * without it (its matched null). For each of the three intensities every
 * household gets an episode of that intensity, so a seed contributes three
 * episodes and three nulls. Reported per rule:
 *
 *   detected   an alert on the onset care day or within the next two days
 *   delay      care days from onset to the alert, median over detections
 *   false      alerts per household-month on the nulls, and on episode tapes
 *              outside [onset - 1, onset + duration + 3]
 *
 * This is a simulation of the method. It makes no clinical claim.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runSignal, simulate, type Intensity, type SignalRule } from "../../packages/core/src";

const DAYS = 90;
const INTENSITIES: Intensity[] = ["strong", "moderate", "subtle"];
const RULES: SignalRule[] = ["mantel", "questions-only"];

export interface RuleResult {
  rule: SignalRule;
  detected: Record<Intensity, { hit: number; n: number }>;
  medianDelay: number;
  nullAlerts: number;
  nullDays: number;
  offEpisodeAlerts: number;
  offEpisodeDays: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN;
}

export function bench(seeds: number[]): RuleResult[] {
  return RULES.map((rule) => {
    const detected = Object.fromEntries(INTENSITIES.map((i) => [i, { hit: 0, n: 0 }])) as RuleResult["detected"];
    const delays: number[] = [];
    let nullAlerts = 0;
    let nullDays = 0;
    let offEpisodeAlerts = 0;
    let offEpisodeDays = 0;
    for (const seed of seeds) {
      for (const intensity of INTENSITIES) {
        const tape = simulate(seed, { days: DAYS, intensity });
        const ep = tape.episode!;
        const decisions = runSignal(tape.days, rule);
        const hitDay = decisions.findIndex((d, i) => d.alert && i >= ep.start && i <= ep.start + 2);
        detected[intensity].n++;
        if (hitDay >= 0) {
          detected[intensity].hit++;
          delays.push(hitDay - ep.start);
        }
        decisions.forEach((d, i) => {
          if (i < 14) return;
          const inside = i >= ep.start - 1 && i <= ep.start + ep.duration + 3;
          if (inside) return;
          offEpisodeDays++;
          if (d.alert) offEpisodeAlerts++;
        });
        const nul = simulate(seed, { days: DAYS, intensity, withEpisode: false });
        runSignal(nul.days, rule).forEach((d, i) => {
          if (i < 14) return;
          nullDays++;
          if (d.alert) nullAlerts++;
        });
      }
    }
    return { rule, detected, medianDelay: median(delays), nullAlerts, nullDays, offEpisodeAlerts, offEpisodeDays };
  });
}

function pct(a: number, b: number) {
  return b ? `${((100 * a) / b).toFixed(1)}%` : "n/a";
}

export function report(label: string, results: RuleResult[]): string {
  const lines = [`${label}`, "rule            strong        moderate      subtle        delay  false/household-month (nulls)  (episode tapes, off-episode)"];
  for (const r of results) {
    const cell = (i: Intensity) => `${r.detected[i].hit}/${r.detected[i].n} ${pct(r.detected[i].hit, r.detected[i].n)}`.padEnd(13);
    const perMonth = (a: number, d: number) => (d ? ((a / d) * 30).toFixed(3) : "n/a");
    lines.push(
      `${r.rule.padEnd(15)} ${cell("strong")} ${cell("moderate")} ${cell("subtle")} ${String(r.medianDelay).padStart(5)}  ${`${perMonth(r.nullAlerts, r.nullDays)} (${r.nullAlerts} in ${r.nullDays} days)`.padEnd(30)}  ${perMonth(r.offEpisodeAlerts, r.offEpisodeDays)} (${r.offEpisodeAlerts} in ${r.offEpisodeDays} days)`,
    );
  }
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const holdout = args.includes("--holdout");
  const seeds = holdout ? Array.from({ length: 40 }, (_, i) => 1001 + i) : Array.from({ length: 40 }, (_, i) => 1 + i);
  const results = bench(seeds);
  console.log(report(holdout ? "held-out seeds 1001-1040" : "dev seeds 1-40", results));
  const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ seeds: [seeds[0], seeds.at(-1)], results }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
