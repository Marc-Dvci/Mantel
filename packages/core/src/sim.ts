/**
 * A household simulator for the Change Signal benchmark and the demo history.
 *
 * Each simulated household has its own rhythm: a daily question rate with
 * over-dispersion, visit days, a slow progression, restless nights at its own
 * rate, and a waking time with its own spread. Two kinds of disturbance are
 * layered on top:
 *
 *  - confounders, which should NOT raise an alert: a family stay the family
 *    forgot to mark as unusual, a single bad night, a single busy day;
 *  - episodes, sudden changes over one or two days that last several days, at
 *    three intensities, touching a random subset of the series.
 *
 * Every household is generated twice from the same seed, once with its episode
 * and once without, so each episode has a matched null. The two tapes are
 * identical up to the onset day.
 *
 * This is a simulation. It exercises the method; it says nothing clinical.
 */

import type { DayFeatures } from "./signal";
import { addDays } from "./time";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private readonly r: () => number;
  constructor(seed: number) {
    this.r = mulberry32(seed);
  }
  u(a = 0, b = 1): number {
    return a + (b - a) * this.r();
  }
  int(a: number, b: number): number {
    return Math.floor(this.u(a, b + 1));
  }
  bool(p: number): boolean {
    return this.r() < p;
  }
  normal(mu = 0, sd = 1): number {
    const u1 = Math.max(this.r(), 1e-12);
    const u2 = this.r();
    return mu + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  exp(mean: number): number {
    return -mean * Math.log(Math.max(this.r(), 1e-12));
  }
  /** Marsaglia-Tsang. */
  gamma(shape: number, scale: number): number {
    if (shape < 1) return this.gamma(shape + 1, scale) * Math.pow(this.r(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.r();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 60) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.r();
    } while (p > L);
    return k - 1;
  }
  /** Negative binomial as a gamma-Poisson mixture: mean mu, variance mu + mu^2/k. */
  negbin(mu: number, k: number): number {
    return this.poisson(this.gamma(k, mu / k));
  }
}

export type Intensity = "strong" | "moderate" | "subtle";

export interface Episode {
  start: number; // day index of onset
  ramp: 1 | 2;
  duration: number;
  intensity: Intensity;
  series: { questions: boolean; night: boolean; firstSeen: boolean };
}

export interface Profile {
  qBase: number;
  qShape: number;
  visitWeekdays: number[];
  visitFactor: number;
  progressionPerWeek: number;
  nightUpProb: number;
  nightUpMean: number;
  firstMean: number;
  firstSd: number;
  doorOpenProb: number;
}

export interface Confounder {
  kind: "family-stay" | "bad-night" | "busy-day";
  start: number;
  length: number;
  marked: boolean;
}

export interface SimTape {
  seed: number;
  profile: Profile;
  episode?: Episode;
  confounders: Confounder[];
  days: DayFeatures[];
}

const INTENSITY: Record<Intensity, { q: number; nightAdd: number; nightProb: number; firstShift: number }> = {
  strong: { q: 3, nightAdd: 90, nightProb: 0.8, firstShift: 90 },
  moderate: { q: 2, nightAdd: 45, nightProb: 0.6, firstShift: 60 },
  subtle: { q: 1.5, nightAdd: 20, nightProb: 0.4, firstShift: 30 },
};

function drawProfile(rng: Rng): Profile {
  const visits = rng.int(1, 3);
  const days = new Set<number>();
  while (days.size < visits) days.add(rng.int(0, 6));
  return {
    qBase: rng.u(6, 30),
    qShape: rng.u(4, 12),
    visitWeekdays: [...days],
    visitFactor: rng.u(0.6, 0.9),
    progressionPerWeek: rng.u(0, 0.03),
    nightUpProb: rng.u(0.05, 0.3),
    nightUpMean: rng.u(10, 40),
    firstMean: rng.u(-20, 60),
    firstSd: rng.u(10, 30),
    doorOpenProb: rng.u(0, 0.01),
  };
}

export interface SimOptions {
  days?: number;
  startDate?: string;
  withEpisode?: boolean;
  /** Force an intensity (the benchmark stratifies by it). */
  intensity?: Intensity;
  /** Force the episode onset day. */
  onset?: number;
  /** Force which series the episode touches, and how fast it arrives. */
  series?: Episode["series"];
  ramp?: 1 | 2;
}

export function simulate(seed: number, opts: SimOptions = {}): SimTape {
  const nDays = opts.days ?? 90;
  const start = opts.startDate ?? "2026-06-01";
  // The profile, confounders and episode are drawn from one stream and the
  // daily noise from another, so the matched null shares everything before onset.
  const setup = new Rng(seed * 7919 + 1);
  const profile = drawProfile(setup);
  const confounders: Confounder[] = [];
  const nConf = setup.int(1, 3);
  for (let i = 0; i < nConf; i++) {
    const kind = (["family-stay", "bad-night", "busy-day"] as const)[setup.int(0, 2)]!;
    confounders.push({
      kind,
      start: setup.int(20, nDays - 8),
      length: kind === "family-stay" ? setup.int(3, 7) : 1,
      marked: kind === "family-stay" ? setup.bool(0.5) : false,
    });
  }
  const intensity: Intensity = opts.intensity ?? (["strong", "moderate", "subtle"] as const)[setup.int(0, 2)]!;
  const drawnSeries = { questions: setup.bool(0.7), night: setup.bool(0.7), firstSeen: setup.bool(0.7) };
  if (!drawnSeries.questions && !drawnSeries.night && !drawnSeries.firstSeen) drawnSeries.questions = true;
  const series = opts.series ?? drawnSeries;
  const drawnRamp: 1 | 2 = setup.bool(0.5) ? 1 : 2;
  const drawn: Episode = {
    start: opts.onset ?? setup.int(35, Math.min(80, nDays - 12)),
    ramp: opts.ramp ?? drawnRamp,
    duration: setup.int(3, 10),
    intensity,
    series,
  };
  const episode = opts.withEpisode === false ? undefined : drawn;

  const noise = new Rng(seed * 104729 + 17);
  const days: DayFeatures[] = [];
  for (let i = 0; i < nDays; i++) {
    const date = addDays(start, i);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    let mu = profile.qBase * Math.pow(1 + profile.progressionPerWeek, i / 7);
    if (profile.visitWeekdays.includes(weekday)) mu *= profile.visitFactor;
    let nightUp = profile.nightUpProb;
    let nightMean = profile.nightUpMean;
    let firstShift = 0;
    let doorProb = profile.doorOpenProb;
    let unusual = false;
    let extraNight = 0;

    for (const c of confounders) {
      if (i < c.start || i >= c.start + c.length) continue;
      if (c.kind === "family-stay") {
        mu *= 0.5;
        firstShift += 30;
        unusual = unusual || c.marked;
      } else if (c.kind === "bad-night") {
        extraNight += noise.u(60, 180);
      } else if (c.kind === "busy-day") {
        mu *= 1.6;
      }
    }

    if (episode && i >= episode.start && i < episode.start + episode.duration) {
      const k = INTENSITY[episode.intensity];
      const level = Math.min(1, (i - episode.start + 1) / episode.ramp);
      if (episode.series.questions) mu *= 1 + (k.q - 1) * level;
      if (episode.series.night) {
        nightUp = Math.max(nightUp, k.nightProb * level);
        nightMean += k.nightAdd * level;
        doorProb += 0.1 * level;
      }
      if (episode.series.firstSeen) firstShift += k.firstShift * level;
    }

    const questions = noise.negbin(mu, profile.qShape);
    const up = noise.bool(nightUp);
    // Capped at five hours, which is as long as the night window of any household here.
    const nightMinutes = Math.min(300, Math.round((up ? noise.exp(nightMean) : 0) + extraNight));
    const nightDoorOpens = noise.bool(doorProb) ? 1 : 0;
    const seen = !noise.bool(0.03);
    // Nobody is first seen inside the night window, which ends an hour before waking.
    const firstSeen = seen ? Math.max(-55, Math.round(noise.normal(profile.firstMean + firstShift, profile.firstSd))) : null;
    days.push({ date, questions, nightMinutes, nightDoorOpens, firstSeen, ...(unusual ? { unusual } : {}) });
  }
  return { seed, profile, ...(episode ? { episode } : {}), confounders, days };
}
