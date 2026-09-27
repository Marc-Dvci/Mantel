import { Matcher, UNKNOWN_RESPONSE, addressed, isQuestion, resolveAnswer } from "../packages/core/src";
import { at, household } from "./helpers";

function ask(text: string, hhmm = "14:05") {
  const { h, now } = household(hhmm);
  const m = new Matcher(h).match(text);
  return { h, now, m, answer: m.kind === "answer" ? resolveAnswer(h, m.topic, now) : undefined };
}

describe("matcher", () => {
  it.each([
    ["What day is it?", "builtin-day"],
    ["what's the date today", "builtin-day"],
    ["What time is it", "builtin-time"],
    ["When is Sarah coming?", "visit-sarah"],
    ["is sarah coming today", "visit-sarah"],
    ["Where's my daughter?", "visit-sarah"],
    ["when will I see Tommy", "visit-tom"],
    ["Where is Robert?", "topic-robert"],
    ["where's my husband", "topic-robert"],
    ["I want to see Robert", "topic-robert"],
    ["Has the dog been fed?", "topic-biscuit"],
    ["I can't find my purse", "topic-purse"],
    ["Have I eaten?", "builtin-meal"],
    ["Did I take my pills?", "builtin-pills"],
    ["I want to go home", "builtin-where"],
    ["Who's coming today?", "builtin-visitors"],
    ["what are we doing today", "builtin-next"],
  ])("%s -> %s", (text, topicId) => {
    const { m } = ask(text);
    expect(m.kind).toBe("answer");
    if (m.kind === "answer") expect(m.topic.id).toBe(topicId);
  });

  it("never answers a question about a person with a topic about somebody else", () => {
    const { m } = ask("Where is Tom's father?");
    if (m.kind === "answer") expect(m.topic.about ?? m.topic.entities?.[0]).toBe("tom");
    // A name the household never mentioned is not recognised as a name, and
    // still gets no answer: "where" alone is not enough to match "where am I".
    expect(ask("Where is Dorothy?").m.kind).toBe("unknown");
  });

  it("never answers a question naming nobody with a topic about somebody", () => {
    const { m } = ask("Where is he?");
    expect(m.kind).toBe("unknown");
  });

  it("tolerates a one-letter slip in a name from speech recognition", () => {
    expect(ask("when is sara coming").m).toMatchObject({ kind: "answer", topic: { id: "visit-sarah" } });
  });

  it("leaves conversation and TV chatter alone", () => {
    for (const text of ["The weather is nice today", "and then we went to the store", "that's a lovely dress", "yes"]) {
      expect(ask(text).m.kind).toBe("unknown");
    }
  });

  it("returns unknown for questions it has no answer for", () => {
    for (const text of ["Is it going to rain?", "Where are my glasses?", "Did the paper come?"]) {
      expect(ask(text).m.kind).toBe("unknown");
    }
  });

  it("uses only approved topics", () => {
    const { h, now } = household();
    const robert = h.topics.find((t) => t.id === "topic-robert")!;
    delete robert.approvedBy;
    expect(new Matcher(h).match("Where is Robert?").kind).toBe("unknown");
    expect(now).toBeTruthy();
  });

  it("detects questions and addressing modes", () => {
    expect(isQuestion("Is Sarah coming")).toBe(true);
    expect(isQuestion("tell me what day it is")).toBe(true);
    expect(isQuestion("Sarah is lovely")).toBe(false);
    expect(addressed("what day is it", "questions")).toBe(true);
    expect(addressed("what day is it", "name")).toBe(false);
    expect(addressed("Mantel, what day is it", "name")).toBe(true);
    expect(addressed("what day is it", "off")).toBe(false);
  });
});

describe("answers", () => {
  it("answers the day from the clock", () => {
    const { answer } = ask("What day is it?");
    expect(answer?.text).toBe("It's Tuesday afternoon, September 29.");
    expect(answer?.speech).toBe("It's Tuesday afternoon, the 29th of September.");
    expect(answer?.source).toBe("clock");
  });

  it("answers a visit from the plan, with the visitor's photo", () => {
    const { answer } = ask("When is Sarah coming?");
    expect(answer?.text).toBe("Sarah is coming today at 4 o'clock.");
    expect(answer?.speech).toBe("Sarah is coming today at four o'clock.");
    expect(answer?.photo).toBe("photo-sarah");
    expect(answer?.attribution).toBe("From today's plan");
  });

  it("looks ahead to the next planned visit", () => {
    expect(ask("When is Tom coming?").answer?.text).toBe("Tom is coming tomorrow at 11 o'clock.");
  });

  it("falls back to the family's words when no visit is planned", () => {
    const { h, now } = household();
    h.plan = h.plan.filter((p) => p.who !== "sarah");
    const m = new Matcher(h).match("When is Sarah coming?");
    expect(m.kind).toBe("answer");
    if (m.kind === "answer") expect(resolveAnswer(h, m.topic, now).text).toBe("Sarah loves you and will see you soon.");
  });

  it("says the family's own words, with their recording and who wrote them", () => {
    const { answer } = ask("Where is Robert?");
    expect(answer?.text).toBe("Robert loved this house. Shall we look at your photos from Lake Tahoe?");
    expect(answer?.audio).toBe("audio-robert-sarah");
    expect(answer?.attribution).toBe("Sarah, on Saturday");
    expect(answer?.source).toBe("family");
  });

  it("drops to the fallback, and drops the recording, once an answer expires", () => {
    const { h } = household();
    const purse = h.topics.find((t) => t.id === "topic-purse")!;
    purse.expiresAt = at("12:00").toISOString();
    const a = resolveAnswer(h, purse, at("14:05"));
    expect(a.text).toBe("Your purse is safe in the house.");
    expect(a.audio).toBeUndefined();
    expect(a.source).toBe("fallback");
  });

  it("confirms pills only when someone marked them taken, and never says they were missed", () => {
    expect(ask("Did I take my pills?", "14:05").answer?.text).toBe("Yes. You took your pills at 9:14 with Anna.");
    const early = ask("Did I take my pills?", "08:00").answer?.text;
    expect(early).toBe("Your pills are looked after. Anna helps you with them.");
    expect(early).not.toMatch(/not|haven|missed|forgot|take them/i);
  });

  it("answers meals from what was marked", () => {
    expect(ask("Have I eaten?", "14:05").answer?.text).toBe("You had lunch at 12:52.");
    expect(ask("Have I eaten?", "08:00").answer?.text).toBe("Breakfast is at half past 8.");
  });

  it("has a neutral reply for everything else", () => {
    expect(UNKNOWN_RESPONSE.text).toBe("Let's look at today together.");
  });
});
