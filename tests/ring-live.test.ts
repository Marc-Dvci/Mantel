import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { loadConfig } from "../apps/server/src/config";
import { LocalMedia } from "../apps/server/src/media";
import { RingClient, deviceKind, historyToEvent, sideload } from "../apps/server/src/ring";
import { RingLink } from "../apps/server/src/ringlive";
import { RingSimulator, SIM_DOORBELL } from "../apps/server/src/ringsim";
import { DEMO_HID, seedDemo } from "../apps/server/src/seed";
import { Clock, Mantel } from "../apps/server/src/service";
import { LocalStore } from "../apps/server/src/store";

/**
 * The Ring account path: discovery, link, and the doorbell's event history
 * turned into the same door card a webhook makes. Driven over HTTP against the
 * simulator's `/v1/devices` and `/v1/history/devices/{id}/events`, with no
 * webhook delivered, as on an account with no app registered.
 */

let server: Server;
let base: string;
let mantel: Mantel;
let sim: RingSimulator;
let link: RingLink;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantel-ring-"));
  const fixtures = join(dir, "fixtures");
  mkdirSync(fixtures);
  for (const v of ["stranger", "sarah", "courier", "empty"]) writeFileSync(join(fixtures, `door-${v}.jpg`), Buffer.from([0xff, 0xd8, 0xff, v.length]));
  const ref = { base: "" };
  const ring = new RingClient("http://placeholder/ring-sim", async () => "playground-token", (input, init) =>
    fetch(String(input).replace("http://placeholder", ref.base), init),
  );
  mantel = new Mantel({ config: loadConfig({}), store: new LocalStore(), media: new LocalMedia(join(dir, "media"), fixtures), ring, clock: new Clock() });
  sim = new RingSimulator("http://127.0.0.1:1/unused", "unused", fixtures);
  const app = createApp(mantel, { sim });
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ref.base = base;
  await seedDemo(mantel);
  link = new RingLink(mantel, ring);
});

afterAll(() => {
  server.close();
});

describe("reading a Ring account", () => {
  it("joins a compound document's included resources onto their devices", () => {
    const [d] = sideload(
      [{ id: "a", attributes: { name: "Front" }, relationships: { capabilities: { data: { type: "device-capabilities", id: "a.c" } } } }],
      [{ type: "device-capabilities", id: "a.c", attributes: { video: { codecs: ["AVC"] } } }],
    );
    expect(d!.attributes).toMatchObject({ name: "Front", capabilities: { video: { codecs: ["AVC"] } } });
  });

  it("calls a video device a camera and a device that reports presses a doorbell", () => {
    expect(deviceKind({ attributes: { capabilities: { video: {} } } })).toBe("camera");
    expect(deviceKind({ attributes: { name: "Front Doorbell", capabilities: { video: {} } } })).toBe("doorbell");
    expect(deviceKind({ attributes: { capabilities: { battery_status: {} } } })).toBe("other");
  });

  it("reads a history ding as a press and motion.human as a person", () => {
    expect(historyToEvent({ id: "1", eventType: "ding", timestamp: 5 }, "d")).toMatchObject({ type: "button_press", requestId: "history:1", deviceId: "d" });
    expect(historyToEvent({ id: "2", eventType: "motion.human", timestamp: 5 }, "d")).toMatchObject({ type: "motion_detected", subType: "human" });
    expect(historyToEvent({ id: "3", eventType: "on_demand", timestamp: 5 }, "d")).toBeUndefined();
  });
});

describe("a linked doorbell's event history", () => {
  it("links the account's camera to the household by its Ring id", async () => {
    sim.pressHistoryOnly("stranger", Date.now() - 120_000);
    const linked = await link.link(DEMO_HID);
    expect(linked?.id).toBe(SIM_DOORBELL);
    const s = await mantel.state(DEMO_HID);
    expect(s.ringDevices.find((d) => d.id === SIM_DOORBELL)).toMatchObject({ source: "ring-api" });
    expect(s.ringDevices.some((d) => d.kind === "contact")).toBe(true);
  });

  it("does not replay a press that was already history when the household linked", async () => {
    expect(await link.poll()).toEqual([]);
    expect((await mantel.state(DEMO_HID)).doorCard).toBeUndefined();
  });

  it("turns a new press into the door card, with the frame from the image download", async () => {
    sim.pressHistoryOnly("stranger", Date.now() + 1_000);
    const done = await link.poll();
    expect(done).toHaveLength(1);
    expect(done[0]!.reason).toMatch(/^door card: /);
    const s = await mantel.state(DEMO_HID);
    expect(s.doorCard?.snapshot).toMatch(/^snapshot-/);
    expect(s.alerts.at(-1)?.kind).toMatch(/^door\./);
  });

  it("acts on each press once across polls", async () => {
    expect(await link.poll()).toEqual([]);
  });
});
