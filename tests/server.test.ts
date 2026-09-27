import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { zonedInstant } from "../packages/core/src";
import { createApp } from "../apps/server/src/app";
import { loadConfig } from "../apps/server/src/config";
import { LocalMedia, mediaKey } from "../apps/server/src/media";
import { RingClient, envelope, sign } from "../apps/server/src/ring";
import { RingSimulator, SIM_DOORBELL, SIM_FRONT_DOOR } from "../apps/server/src/ringsim";
import { DEMO_HID, seedDemo } from "../apps/server/src/seed";
import { Clock, Mantel } from "../apps/server/src/service";
import { LocalStore } from "../apps/server/src/store";

const TZ = "America/New_York";
let server: Server;
let base: string;
let mantel: Mantel;
const secret = "test-webhook-secret";

async function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${path}`, { ...init, headers, ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}) });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function setClock(time: string, date = "2026-09-29") {
  mantel.clock.setTo(zonedInstant(date, time, TZ));
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantel-"));
  const fixtures = join(dir, "fixtures");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(fixtures);
  for (const v of ["stranger", "sarah", "courier", "empty"]) writeFileSync(join(fixtures, `door-${v}.jpg`), Buffer.from([0xff, 0xd8, 0xff, v.length]));
  const config = { ...loadConfig({}), ring: { ...loadConfig({}).ring, webhookSecret: secret } };
  const clock = new Clock();
  const ringRef: { base: string } = { base: "" };
  mantel = new Mantel({
    config,
    store: new LocalStore(),
    media: new LocalMedia(join(dir, "media"), fixtures),
    ring: new RingClient("http://placeholder/ring-sim", async () => undefined, (input, init) =>
      fetch(String(input).replace("http://placeholder", ringRef.base), init),
    ),
    clock,
  });
  const sim = new RingSimulator("http://placeholder/ring/webhook", secret, fixtures);
  const app = createApp(mantel, { sim });
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ringRef.base = base;
  (sim as unknown as { webhookUrl: string }).webhookUrl = `${base}/ring/webhook`;
  await setClock("10:00");
  await seedDemo(mantel);
});

afterAll(() => {
  server?.close();
});

describe("TV API", () => {
  it("requires a TV token", async () => {
    expect((await call("/api/tv/state")).status).toBe(401);
    expect((await call("/api/tv/state", { token: "demo-sarah" })).status).toBe(403);
  });

  it("sends only approved words to the TV", async () => {
    const { status, body } = await call("/api/tv/state", { token: "demo-tv" });
    expect(status).toBe(200);
    expect(body.household.topics.every((t: any) => t.approvedBy)).toBe(true);
    expect(body.household.moments.some((m: any) => m.id === "m-birthday")).toBe(false);
    expect(body.mediaKey).toBe(mediaKey(mantel.deps.config.secret, DEMO_HID));
  });

  it("long-polls: a change wakes a waiting TV", async () => {
    const first = await call("/api/tv/state", { token: "demo-tv" });
    const started = Date.now();
    const waiting = call(`/api/tv/state?since=${first.body.version}&wait=10000`, { token: "demo-tv" });
    setTimeout(() => void call("/api/family/topics/topic-purse", { method: "PUT", token: "demo-sarah", json: { answer: "Your purse is on the hall table." } }), 300);
    const woke = await waiting;
    expect(woke.body.version).toBeGreaterThan(first.body.version);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("marks a message played so it never plays twice", async () => {
    await call("/api/tv/events", { method: "POST", token: "demo-tv", json: { events: [{ type: "message.played", data: { id: "msg-morning" } }] } });
    const { body } = await call("/api/tv/state", { token: "demo-tv" });
    expect(body.household.messages.map((m: any) => m.id)).not.toContain("msg-morning");
  });
});

describe("Ring webhook", () => {
  const press = (tsMs: number) => JSON.stringify(envelope("button_press", SIM_DOORBELL, tsMs));

  it("refuses a delivery with a bad signature", async () => {
    const raw = press(Date.now());
    const res = await fetch(`${base}/ring/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-signature": sign(raw, "wrong") }, body: raw });
    expect(res.status).toBe(401);
  });

  it("an unexpected press puts the card on the TV, tells Sarah, and attaches the snapshot", async () => {
    await setClock("14:00");
    const res = await call("/api/dev/ring/press", { method: "POST", json: { visitor: "stranger" } });
    expect(res.body.status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    const tv = await call("/api/tv/state", { token: "demo-tv" });
    expect(tv.body.doorCard.kind).toBe("unexpected");
    expect(tv.body.doorCard.snapshot).toMatch(/^snapshot-/);
    const img = await fetch(`${base}/media/${DEMO_HID}/${tv.body.doorCard.snapshot}?k=${tv.body.mediaKey}`);
    expect(img.status).toBe(200);
    const fam = await call("/api/family/overview", { token: "demo-sarah" });
    expect(fam.body.alerts[0]).toMatchObject({ kind: "door.unexpected", urgency: "attention" });
  });

  it("is idempotent on request_id", async () => {
    const raw = press(Date.now());
    const headers = { "content-type": "application/json", "x-signature": sign(raw, secret) };
    const a = await fetch(`${base}/ring/webhook`, { method: "POST", headers, body: raw });
    const b = await fetch(`${base}/ring/webhook`, { method: "POST", headers, body: raw });
    expect(a.status).toBe(200);
    expect((await b.json()).reason).toBe("duplicate");
  });

  it("an expected visit names the visitor", async () => {
    await setClock("15:58");
    await call("/api/dev/ring/press", { method: "POST", json: { visitor: "sarah" } });
    const tv = await call("/api/tv/state", { token: "demo-tv" });
    expect(tv.body.doorCard.kind).toBe("expected-visit");
    expect(tv.body.doorCard.visitor).toBe("sarah");
  });

  it("the front door opening at night is urgent; by day it is only recorded", async () => {
    await setClock("15:00");
    await call("/api/dev/ring/contact", { method: "POST", json: { open: true } });
    let fam = await call("/api/family/overview", { token: "demo-sarah" });
    expect(fam.body.alerts.some((a: any) => a.kind === "night.door-open")).toBe(false);
    await setClock("03:10", "2026-09-30");
    const r = await call("/api/dev/ring/contact", { method: "POST", json: { open: true } });
    expect(JSON.parse(r.body.text).reason).toBe("night door alert");
    fam = await call("/api/family/overview", { token: "demo-sarah" });
    expect(fam.body.alerts[0]).toMatchObject({ kind: "night.door-open", urgency: "urgent" });
    void SIM_FRONT_DOOR;
  });
});

describe("family API", () => {
  it("a grandson's topic waits for Sarah's approval before the TV uses it", async () => {
    await setClock("11:00");
    const created = await call("/api/family/topics", {
      method: "POST",
      token: "demo-tom",
      json: { label: "The garden", phrasings: ["who waters the garden"], policy: "tell", answer: "Tom waters the garden on Saturdays." },
    });
    expect(created.status).toBe(200);
    expect(created.body.approvedBy).toBeUndefined();
    let tv = await call("/api/tv/state", { token: "demo-tv" });
    expect(tv.body.household.topics.some((t: any) => t.id === created.body.id)).toBe(false);
    expect((await call(`/api/family/topics/${created.body.id}/approve`, { method: "POST", token: "demo-tom" })).status).toBe(403);
    expect((await call(`/api/family/topics/${created.body.id}/approve`, { method: "POST", token: "demo-sarah" })).status).toBe(200);
    tv = await call("/api/tv/state", { token: "demo-tv" });
    expect(tv.body.household.topics.some((t: any) => t.id === created.body.id)).toBe(true);
  });

  it("changing an answer's words drops the old recording", async () => {
    const { body } = await call("/api/family/topics/topic-robert", { method: "PUT", token: "demo-sarah", json: { answer: "Robert loved you very much." } });
    expect(body.audio).toBeUndefined();
    expect(body.approvedBy).toBe("sarah");
  });

  it("shows the Change Signal alert from the seeded history", async () => {
    const fam = await call("/api/family/overview", { token: "demo-sarah" });
    const change = fam.body.alerts.find((a: any) => a.kind === "change");
    expect(change?.body).toMatch(/Consider calling Margaret's doctor/);
  });

  it("writes a digest for a past day from counts", async () => {
    const d = await call("/api/family/digest/2026-09-27", { token: "demo-sarah" });
    expect(d.status).toBe(200);
    expect(d.body.prose).toMatch(/^Margaret was first seen at/);
  });

  it("drafts a caption without a model from the facts given", async () => {
    const d = await call("/api/family/drafts/caption", { method: "POST", token: "demo-tom", json: { people: ["Robert"], place: "Cape Cod", year: "1972" } });
    expect(d.body).toMatchObject({ text: "You and Robert at Cape Cod, 1972.", source: "template" });
  });

  it("pairs a TV with a six-digit code, once", async () => {
    const { body } = await call("/api/family/tv/pair-code", { method: "POST", token: "demo-sarah" });
    expect(body.code).toMatch(/^\d{6}$/);
    const paired = await call("/api/tv/pair", { method: "POST", json: { code: body.code, name: "Bedroom TV" } });
    expect(paired.body.token).toMatch(/^tv_/);
    expect((await call("/api/tv/state", { token: paired.body.token })).status).toBe(200);
    expect((await call("/api/tv/pair", { method: "POST", json: { code: body.code } })).status).toBe(404);
  });

  it("refuses media without the household key", async () => {
    expect((await fetch(`${base}/media/${DEMO_HID}/photo-sarah?k=nope`)).status).toBe(403);
  });

  it("reports what is stored and can erase it", async () => {
    const p = await call("/api/family/privacy", { token: "demo-sarah" });
    expect(p.body.neverLeavesTheTv).toContain("camera frames");
    expect((await call("/api/family/privacy/erase", { method: "POST", token: "demo-tom" })).status).toBe(403);
  });
});
