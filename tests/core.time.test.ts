import {
  addDays,
  clockFace,
  inWindow,
  localParts,
  parseClock,
  partOfDay,
  relativeDay,
  spokenDate,
  spokenTime,
  spokenTimeWords,
  zonedInstant,
} from "../packages/core/src";

const TZ = "America/New_York";

describe("household time", () => {
  it("reads local parts in the household's zone", () => {
    const p = localParts(new Date("2026-09-29T19:58:00Z"), TZ);
    expect(p.date).toBe("2026-09-29");
    expect(p.hour).toBe(15);
    expect(p.minute).toBe(58);
    expect(p.weekday).toBe(2); // Tuesday
  });

  it("round-trips a wall-clock time through an instant, across DST", () => {
    for (const [date, hhmm] of [["2026-09-29", "16:00"], ["2026-11-01", "01:30"], ["2026-03-08", "03:30"], ["2026-12-24", "07:00"]] as const) {
      const inst = zonedInstant(date, hhmm, TZ);
      const p = localParts(inst, TZ);
      expect(p.date).toBe(date);
      expect(clockFace(p.minuteOfDay).padStart(5, "0").slice(-5)).toBe(clockFace(parseClock(hhmm)).padStart(5, "0").slice(-5));
    }
  });

  it("says times the way people say them", () => {
    expect(spokenTime(parseClock("16:00"))).toBe("4 o'clock");
    expect(spokenTime(parseClock("16:30"))).toBe("half past 4");
    expect(spokenTime(parseClock("09:15"))).toBe("quarter past 9");
    expect(spokenTime(parseClock("09:45"))).toBe("quarter to 10");
    expect(spokenTime(parseClock("11:45"))).toBe("quarter to 12");
    expect(spokenTime(parseClock("12:00"))).toBe("midday");
    expect(spokenTime(parseClock("16:20"))).toBe("4:20");
    expect(spokenTimeWords(parseClock("16:30"))).toBe("half past four");
    expect(spokenTimeWords(parseClock("16:20"))).toBe("4:20");
  });

  it("names the part of the day", () => {
    expect(partOfDay(parseClock("06:00"))).toBe("morning");
    expect(partOfDay(parseClock("12:00"))).toBe("afternoon");
    expect(partOfDay(parseClock("17:30"))).toBe("evening");
    expect(partOfDay(parseClock("03:10"))).toBe("night");
  });

  it("handles windows that wrap midnight", () => {
    expect(inWindow(parseClock("23:00"), parseClock("21:30"), parseClock("07:00"))).toBe(true);
    expect(inWindow(parseClock("03:00"), parseClock("21:30"), parseClock("07:00"))).toBe(true);
    expect(inWindow(parseClock("07:00"), parseClock("21:30"), parseClock("07:00"))).toBe(false);
  });

  it("writes dates for the screen and for speech", () => {
    expect(spokenDate("2026-09-01")).toBe("the 1st of September");
    expect(spokenDate("2026-09-12")).toBe("the 12th of September");
    expect(relativeDay("2026-09-29", "2026-09-29")).toBe("today");
    expect(relativeDay("2026-09-29", "2026-09-30")).toBe("tomorrow");
    expect(relativeDay("2026-09-29", "2026-10-01")).toBe("on Thursday");
    expect(relativeDay("2026-09-29", "2026-10-09")).toBe("on October 9");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
