import { computeToday, nextMessage, screenMode, parseClock } from "../packages/core/src";
import { at, household } from "./helpers";

describe("Today screen", () => {
  it("shows the day, the part of the day and what comes next", () => {
    const { h, now } = household("14:05");
    const t = computeToday(h, now);
    expect(t.dayName).toBe("Tuesday");
    expect(t.headline).toBe("Tuesday afternoon");
    expect(t.dateLine).toBe("September 29");
    expect(t.clock).toBe("2:05");
    expect(t.next?.line).toBe("Sarah is coming at 4 o'clock");
    expect(t.next?.photo).toBe("photo-sarah");
    expect(t.next?.soon).toBe(false);
    expect(t.done).toEqual(["Pills taken at 9:14.", "Lunch is done."]);
    expect(t.mode).toBe("day");
  });

  it("keeps a visit as next through its window, so it does not vanish at 4:01", () => {
    const { h, now } = household("16:20");
    expect(computeToday(h, now).next?.line).toBe("Sarah is coming at 4 o'clock");
  });

  it("drops a visit once it is marked done", () => {
    const { h } = household("16:20");
    const visit = h.plan.find((p) => p.who === "sarah")!;
    visit.doneAt = at("16:02").toISOString();
    const t = computeToday(h, at("16:20"));
    expect(t.next?.line).toBe("Dinner at 6 o'clock");
    expect(t.done.at(-1)).toBe("Sarah came at 4:02.");
  });

  it("switches to evening and night modes from the household's own hours", () => {
    const { h } = household();
    expect(screenMode(h, parseClock("17:00"))).toBe("evening");
    expect(screenMode(h, parseClock("22:00"))).toBe("night");
    expect(screenMode(h, parseClock("03:10"))).toBe("night");
    expect(screenMode(h, parseClock("07:00"))).toBe("day");
    const t = computeToday(h, at("03:10"));
    expect(t.mode).toBe("night");
    expect(t.nightLines[0]).toBe("It's night-time.");
  });
});

describe("messages", () => {
  it("plays the morning message on first presence after 7, once, and never to an empty room", () => {
    const { h } = household("07:42");
    expect(nextMessage(h, at("07:42"), false)).toBeUndefined();
    expect(nextMessage(h, at("06:55"), true)).toBeUndefined();
    const m = nextMessage(h, at("07:42"), true);
    expect(m?.id).toBe("msg-morning");
    m!.playedAt = at("07:42").toISOString();
    expect(nextMessage(h, at("07:43"), true)).toBeUndefined();
  });

  it("holds the evening message until the evening window ends, and never plays at night", () => {
    const { h } = household("07:42");
    h.messages[0]!.playedAt = at("07:42").toISOString();
    expect(nextMessage(h, at("19:00"), true)).toBeUndefined();
    expect(nextMessage(h, at("19:35"), true)?.id).toBe("msg-evening");
    expect(nextMessage(h, at("22:10"), true)).toBeUndefined();
  });

  it("never plays an unapproved message", () => {
    const { h } = household("07:42");
    delete h.messages[0]!.approvedBy;
    expect(nextMessage(h, at("07:42"), true)).toBeUndefined();
  });
});
