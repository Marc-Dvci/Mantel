/**
 * A local Ring: the documented device list as a JSON:API compound document,
 * the camera event history, the documented image download (303 to a
 * pre-signed URL), and signed v1.1 webhooks delivered over HTTP to the
 * server's own webhook endpoint. The webhook and history paths the simulator
 * exercises are the production ones; only the sender differs.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { BUTTON_PRESS, CONTACT_CLEARED, CONTACT_FAULTED, envelope, sign } from "./ring";

export const SIM_DOORBELL = "ava1.ring.device.DOORBELL01";
export const SIM_FRONT_DOOR = "ava1.ring.device.FRONTDOOR";

export type Visitor = "sarah" | "stranger" | "courier" | "empty";

export class RingSimulator {
  /** Who is standing at the door, for the next snapshot. */
  private visitor: Visitor = "empty";
  private readonly presigned = new Map<string, Visitor>();
  /** The doorbell's event history, as `GET /v1/history/devices/{id}/events` serves it. */
  private readonly history: { id: string; type: "events"; attributes: { event_type: string; start: string } }[] = [];

  constructor(
    private readonly webhookUrl: string,
    private readonly secret: string,
    private readonly fixtures: string,
  ) {}

  router(): Router {
    const r = Router();
    r.get("/v1/devices", (_req, res) => {
      const rel = (id: string) => ({ capabilities: { data: { type: "device-capabilities", id: `${id}.capabilities` } } });
      res.json({
        meta: { time: new Date().toISOString() },
        data: [
          { type: "devices", id: SIM_DOORBELL, attributes: { name: "Front Door" }, relationships: rel(SIM_DOORBELL) },
          { type: "devices", id: SIM_FRONT_DOOR, attributes: { name: "Front door" }, relationships: rel(SIM_FRONT_DOOR) },
        ],
        included: [
          {
            type: "device-capabilities",
            id: `${SIM_DOORBELL}.capabilities`,
            attributes: { video: { codecs: ["AVC"], max_resolution: 1080 }, motion_detection: { configurations: ["enabled"] } },
          },
          { type: "device-capabilities", id: `${SIM_FRONT_DOOR}.capabilities`, attributes: { battery_status: { supported: true } } },
        ],
      });
    });
    r.get("/v1/history/devices/:id/events", (req, res) => {
      const since = Number(req.query.start_time ?? 0);
      res.json({ data: this.history.filter((e) => req.params.id === SIM_DOORBELL && Date.parse(e.attributes.start) >= since) });
    });
    r.post("/v1/devices/:id/media/image/download", (req: Request, res: Response) => {
      if (req.params.id !== SIM_DOORBELL) {
        res.status(404).json({ errors: [{ status: "404", title: "Not Found", detail: "Device has no camera" }] });
        return;
      }
      const token = randomBytes(12).toString("hex");
      this.presigned.set(token, this.visitor);
      res.status(303).location(`/ring-sim/presigned/${token}.jpg`).end();
    });
    r.get("/presigned/:file", (req, res) => {
      const visitor = this.presigned.get(req.params.file.replace(/\.jpg$/, ""));
      if (!visitor) {
        res.status(403).send("expired");
        return;
      }
      const file = join(this.fixtures, `door-${visitor}.jpg`);
      if (!existsSync(file)) {
        res.status(404).send("no fixture");
        return;
      }
      res.type("image/jpeg").send(readFileSync(file));
    });
    return r;
  }

  private async deliver(body: object): Promise<{ status: number; text: string }> {
    const raw = JSON.stringify(body);
    const res = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sign(raw, this.secret) },
      body: raw,
    });
    return { status: res.status, text: await res.text() };
  }

  async press(visitor: Visitor, atMs: number) {
    this.visitor = visitor;
    this.remember("ding", atMs);
    return this.deliver(envelope(BUTTON_PRESS, SIM_DOORBELL, atMs));
  }

  /** A press that reaches only the event history, as on an account with no webhook registered. */
  pressHistoryOnly(visitor: Visitor, atMs: number) {
    this.visitor = visitor;
    this.remember("ding", atMs);
  }

  private remember(eventType: string, atMs: number) {
    this.history.push({ id: `evt-${atMs}-${this.history.length}`, type: "events", attributes: { event_type: eventType, start: new Date(atMs).toISOString() } });
  }

  async contact(open: boolean, atMs: number) {
    return this.deliver(envelope(open ? CONTACT_FAULTED : CONTACT_CLEARED, SIM_FRONT_DOOR, atMs));
  }
}
