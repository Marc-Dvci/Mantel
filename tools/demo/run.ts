/**
 * One day in Margaret's home, in a terminal.
 *
 *   pnpm demo
 *
 * Runs the real server in-process on a free port with the demo household, then
 * walks the day: the TV's Today screen, questions asked out loud, a doorbell
 * nobody expected, Sarah's own doorbell press, the night, and the next
 * morning's Change Signal. Every line below comes from an HTTP call into the
 * server or from the same core code the TV runs.
 */

import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Matcher, UNKNOWN_RESPONSE, computeToday, resolveAnswer, type Household } from "../../packages/core/src";
import { createApp } from "../../apps/server/src/app";
import { FIXTURE_MEDIA } from "../../apps/server/src/build";
import { loadConfig } from "../../apps/server/src/config";
import { LocalMedia } from "../../apps/server/src/media";
import { RingClient } from "../../apps/server/src/ring";
import { RingSimulator } from "../../apps/server/src/ringsim";
import { Clock, Mantel } from "../../apps/server/src/service";
import { LocalStore } from "../../apps/server/src/store";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const pause = (ms: number) => new Promise((r) => setTimeout(r, process.argv.includes("--fast") ? 0 : ms));

const dir = mkdtempSync(join(tmpdir(), "mantel-demo-"));
const config = loadConfig({ MANTEL_DATA_DIR: dir });
const ringBase = { url: "" };
const mantel = new Mantel({
  config,
  store: new LocalStore(),
  media: new LocalMedia(join(dir, "media"), FIXTURE_MEDIA),
  ring: new RingClient("http://ring.local/ring-sim", async () => undefined, (input, init) => fetch(String(input).replace("http://ring.local", ringBase.url), init)),
  clock: new Clock(),
});
const sim = new RingSimulator("", config.ring.webhookSecret, FIXTURE_MEDIA);
const app = createApp(mantel, { sim });
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
ringBase.url = base;
(sim as unknown as { webhookUrl: string }).webhookUrl = `${base}/ring/webhook`;

async function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.json !== undefined ? { "content-type": "application/json" } : {}) },
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  });
  return res.json() as Promise<any>;
}

async function at(time: string) {
  await call("/api/dev/clock", { method: "POST", json: { time } });
}

async function tv(): Promise<{ h: Household; now: Date; state: any }> {
  const state = await call("/api/tv/state", { token: "demo-tv" });
  return { h: state.household, now: new Date(state.serverNow), state };
}

function scene(title: string) {
  console.log(`\n${bold(title)}`);
}

async function ask(text: string) {
  const { h, now } = await tv();
  const m = new Matcher(h, h.topics).match(text);
  console.log(`  Margaret: "${text}"`);
  if (m.kind === "answer") {
    const a = resolveAnswer(h, m.topic, now);
    console.log(`  TV:       ${a.text} ${dim(`(${a.attribution}${a.audio ? ", in Sarah's recorded voice" : ""})`)}`);
    await call("/api/tv/events", { method: "POST", token: "demo-tv", json: { events: [{ type: "question", data: { text, topicId: m.topic.id, score: m.score } }] } });
  } else {
    console.log(`  TV:       ${UNKNOWN_RESPONSE.text} ${dim(`(no answer yet: saved for the family, ${m.reason})`)}`);
    await call("/api/tv/events", { method: "POST", token: "demo-tv", json: { events: [{ type: "question", data: { text, topicId: null, score: 0 } }] } });
  }
  await pause(500);
}

await call("/api/dev/reset", { method: "POST", json: { time: "07:42" } });

scene("7:42 in the morning. Margaret walks into the living room.");
{
  const { h, now } = await tv();
  const t = computeToday(h, now);
  console.log(`  Today screen: ${t.headline}, ${t.dateLine}, ${t.clock}. Next: ${t.next?.line ?? "nothing planned"}.`);
  console.log(`  Message: "${h.messages[0]?.text}" ${dim("(Sarah recorded it last night; it plays once, now that Margaret is here)")}`);
  await call("/api/tv/events", { method: "POST", token: "demo-tv", json: { events: [{ type: "presence.start" }, { type: "message.played", data: { id: "msg-morning" } }] } });
}

await at("14:05");
scene("2:05 in the afternoon. The questions of a long day.");
for (const q of ["What day is it?", "When is Sarah coming?", "Where is Robert?", "When is Sarah coming?", "Has the dog been fed?", "Is it going to rain?"]) await ask(q);

scene("2:10. The doorbell rings. Nobody is expected.");
await at("14:10");
await call("/api/dev/ring/press", { method: "POST", json: { visitor: "stranger" } });
await new Promise((r) => setTimeout(r, 400));
{
  const { state } = await tv();
  console.log(`  TV:       ${state.doorCard.lines.join(" ")} ${dim(`(Ring snapshot ${state.doorCard.snapshot ? "attached" : "pending"})`)}`);
  const o = await call("/api/family/overview", { token: "demo-sarah" });
  console.log(`  Sarah's phone: ${o.alerts[0].title}. ${o.alerts[0].body}`);
}

scene("3:58. The doorbell again.");
await at("15:58");
await call("/api/dev/ring/press", { method: "POST", json: { visitor: "sarah" } });
{
  const { state } = await tv();
  console.log(`  TV:       ${state.doorCard.lines.join(" ")}`);
}

scene("3:10 at night. Margaret comes into the living room.");
{
  const { h } = await tv();
  const night = new Date(Date.parse((await tv()).state.serverNow) + 11 * 3600_000 + 12 * 60_000);
  const t = computeToday(h, night);
  console.log(`  TV (dimmed): ${t.nightLines[0]} ${t.clock}. ${t.nightLines.slice(1).join(" ")}`);
}

scene("The next morning, on Sarah's phone.");
{
  const o = await call("/api/family/overview", { token: "demo-sarah" });
  const change = o.alerts.find((a: any) => a.kind === "change");
  if (change) console.log(`  ${bold(change.title)}\n  ${change.body}`);
  const d = await call(`/api/family/digest/${o.digests[0]}`, { token: "demo-sarah" });
  console.log(`  Digest for ${o.digests[0]}: ${d.prose}`);
  if (o.unanswered.length) console.log(`  No answer yet for: ${o.unanswered.slice(0, 3).map((u: any) => `"${u.text}" (${u.count})`).join(", ")}`);
}

console.log(dim(`\nEverything above went through ${base}. The TV app and the family app show the same state: pnpm dev.`));
server.close();
