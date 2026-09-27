import {
  baseline,
  changeAlert,
  checkDraft,
  dayFeatures,
  demoHistory,
  digestFacts,
  eventsFromFeatures,
  readDay,
  runSignal,
  simulate,
  digestProse,
  makeDigest,
  type DayFeatures,
} from "../packages/core/src";
import { at, household } from "./helpers";

function flat(n: number, q = 12): DayFeatures[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    questions: q + (i % 3) - 1,
    nightMinutes: i % 5 === 0 ? 15 : 0,
    nightDoorOpens: 0,
    firstSeen: 30 + ((i * 7) % 20) - 10,
  }));
}

describe("Change Signal", () => {
  it("needs a week of usual days before it says anything", () => {
    expect(baseline([1, 2, 3], "questions")).toBeUndefined();
    const days = flat(6);
    days.push({ date: "2026-06-07", questions: 80, nightMinutes: 200, nightDoorOpens: 2, firstSeen: 200 });
    expect(runSignal(days).some((d) => d.alert)).toBe(false);
  });

  it("fires when two series jump on the same day", () => {
    const days = flat(20);
    days.push({ date: "2026-06-21", questions: 45, nightMinutes: 150, nightDoorOpens: 0, firstSeen: 30 });
    const last = runSignal(days).at(-1)!;
    expect(last.alert).toBe(true);
    expect(last.rule).toBe("two-series");
    expect(last.reading.flagged.sort()).toEqual(["nightMinutes", "questions"]);
  });

  it("does not fire on one busy day, and fires if it persists", () => {
    const days = flat(20);
    days.push({ date: "2026-06-21", questions: 45, nightMinutes: 0, nightDoorOpens: 0, firstSeen: 30 });
    expect(runSignal(days).at(-1)!.alert).toBe(false);
    days.push({ date: "2026-06-22", questions: 44, nightMinutes: 0, nightDoorOpens: 0, firstSeen: 30 });
    const last = runSignal(days).at(-1)!;
    expect(last.alert).toBe(true);
    expect(last.rule).toBe("two-days");
  });

  it("absorbs slow drift into the baseline", () => {
    const days = Array.from({ length: 90 }, (_, i) => ({
      date: `d${i}`,
      questions: Math.round(10 * Math.pow(1.03, i / 7)) + (i % 3),
      nightMinutes: 0,
      nightDoorOpens: 0,
      firstSeen: 20 + (i % 9),
    }));
    expect(runSignal(days).filter((d) => d.alert)).toHaveLength(0);
  });

  it("skips days the family marked unusual, in baselines and in alerts", () => {
    const days = flat(20);
    days.push({ date: "2026-06-21", questions: 45, nightMinutes: 150, nightDoorOpens: 0, firstSeen: 30, unusual: true });
    expect(runSignal(days).at(-1)!.alert).toBe(false);
    expect(readDay(days, 20).readings).toHaveLength(0);
  });

  it("waits out a cooldown after an alert", () => {
    const days = flat(20);
    for (let i = 0; i < 3; i++) days.push({ date: `x${i}`, questions: 45, nightMinutes: 150, nightDoorOpens: 0, firstSeen: 30 });
    const alerts = runSignal(days).filter((d) => d.alert);
    expect(alerts).toHaveLength(1);
  });

  it("writes an alert that names what changed and never diagnoses", () => {
    const { h } = household();
    const days = flat(20);
    days.push({ date: "2026-06-21", questions: 45, nightMinutes: 150, nightDoorOpens: 0, firstSeen: 30 });
    const a = changeAlert(h, runSignal(days).at(-1)!, new Date());
    expect(a.body).toMatch(/Asked 45 questions \(usually about 12\)/);
    expect(a.body).toMatch(/Up for 150 minutes during the night/);
    expect(a.body).toMatch(/Consider calling Margaret's doctor/);
    expect(a.body).not.toMatch(/delirium|diagnos|dementia/i);
  });
});

describe("simulator", () => {
  it("is deterministic per seed, and the matched null shares everything before onset", () => {
    const a = simulate(5);
    const b = simulate(5);
    expect(a.days).toEqual(b.days);
    const nul = simulate(5, { withEpisode: false });
    const onset = a.episode!.start;
    expect(nul.days.slice(0, onset)).toEqual(a.days.slice(0, onset));
    expect(nul.episode).toBeUndefined();
  });

  it("raw events rebuild the same care-day features the simulator drew", () => {
    const { h } = household();
    const tape = simulate(11, { days: 20, startDate: "2026-09-01" });
    const events = eventsFromFeatures(h, tape.days);
    const nowMs = at("12:00", "2026-09-25").getTime();
    for (const d of tape.days.slice(0, 19)) {
      const f = dayFeatures(h, events, d.date, nowMs);
      expect(f.questions).toBe(d.questions);
      expect(f.nightDoorOpens).toBe(d.nightDoorOpens);
      expect(f.firstSeen).toBe(d.firstSeen);
      expect(Math.abs((f.nightMinutes ?? 0) - (d.nightMinutes ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  it("the demo history ends in an alert on yesterday", () => {
    const { h, now } = household("07:30");
    const { days } = demoHistory(h, now);
    const decisions = runSignal(days);
    expect(decisions.at(-1)!.alert).toBe(true);
    expect(decisions.slice(0, -1).some((d) => d.alert)).toBe(false);
  });
});

describe("digest", () => {
  it("counts the day and writes it plainly", () => {
    const { h } = household();
    const { events } = demoHistory(h, at("07:30"));
    const date = "2026-09-20";
    const f = digestFacts(h, events, date, at("07:30").getTime(), { questions: 12 });
    const text = digestProse(f);
    expect(text).toMatch(/^Margaret was first seen at \d+:\d\d am/);
    expect(text).toMatch(/questions \(usually about 12\)/);
  });

  it("carries every count, and nothing a count does not support", () => {
    const { h } = household();
    const { events } = demoHistory(h, at("07:30"));
    const d = makeDigest(digestFacts(h, events, "2026-09-20", at("07:30").getTime(), { questions: 12 }));
    expect(d.prose).toContain(`${d.facts.questions} questions`);
    expect(d.prose).not.toMatch(/quiet|calm|good day|bad day|worse|better|many|several/i);
  });

  it("draft checks reject death words unless the family used them", () => {
    const rules = { allowedNames: ["Robert"], allowedNumbers: ["1968"], maxChars: 160 };
    expect(checkDraft("Robert died in 1968.", rules).ok).toBe(false);
    expect(checkDraft("Robert died in 1968.", { ...rules, allowDeathWords: true }).ok).toBe(true);
    expect(checkDraft("You and Robert at Lake Tahoe, 1968.", { ...rules, allowedNames: ["Robert", "Lake", "Tahoe"] }).ok).toBe(true);
    expect(checkDraft("You and Robert in Paris, 1968.", { ...rules, allowedNames: ["Robert"] }).ok).toBe(false);
  });
});
