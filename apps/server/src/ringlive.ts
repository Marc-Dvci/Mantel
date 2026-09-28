/**
 * A Ring account, read through the Ring API.
 *
 * Link time: `GET /v1/devices` finds the account's doorbell, and the household
 * is attached to it by its Ring device id. From then on the doorbell's event
 * history (`GET /v1/history/devices/{id}/events`) is read every few seconds,
 * and each new press becomes the same door card a webhook would have made,
 * through the same decision and the same idempotency key space, with the frame
 * fetched through Ring's image download.
 *
 * This is the path a token from the Ring Developer Playground opens: the token
 * reads the account's devices and history directly, with no app registration
 * and no public webhook URL. A registered app adds webhooks, which arrive at
 * `/ring/webhook` and are deduplicated against these same keys.
 */

import { historyToEvent, type RingAccountDevice, type RingClient } from "./ring";
import type { Mantel } from "./service";
import type { RingDevice } from "./store";

export interface LinkedDevice extends RingAccountDevice {
  hid: string;
  /** Events before this instant were already history when the household linked. */
  linkedAtMs: number;
  /** The newest event read so far. */
  cursorMs: number;
}

export class RingLink {
  private linked: LinkedDevice[] = [];

  constructor(
    private readonly mantel: Mantel,
    private readonly ring: RingClient,
    private readonly log: (msg: string, extra?: Record<string, unknown>) => void = () => {},
  ) {}

  get devices(): readonly LinkedDevice[] {
    return this.linked;
  }

  /**
   * Attach the account's doorbell to a household, replacing any doorbell it
   * had. `preferId` picks a device when the account has several. A camera with
   * no doorbell is linked as a camera: it sees people at the door and never
   * raises a door card, because nobody rang.
   */
  async link(hid: string, preferId?: string): Promise<LinkedDevice | undefined> {
    const { devices } = await this.ring.devices();
    const chosen =
      (preferId && devices.find((d) => d.id === preferId)) ||
      devices.find((d) => d.kind === "doorbell") ||
      devices.find((d) => d.kind === "camera");
    if (!chosen) {
      this.log("ring: no doorbell or camera on this account", { devices: devices.length });
      return undefined;
    }
    const entry: RingDevice = { id: chosen.id, name: chosen.name, kind: chosen.kind === "doorbell" ? "doorbell" : "camera", source: "ring-api" };
    await this.mantel.deps.store.update(hid, (s) => {
      s.ringDevices = [...s.ringDevices.filter((d) => d.kind === "contact"), entry];
    });
    const now = Date.now();
    const device: LinkedDevice = { ...chosen, hid, linkedAtMs: now, cursorMs: now };
    this.linked = [...this.linked.filter((d) => d.hid !== hid), device];
    this.log("ring: linked", { hid, device: chosen.id, name: chosen.name, kind: chosen.kind });
    return device;
  }

  /** Read each linked device's history once and act on anything new. */
  async poll(): Promise<{ device: string; type: string; reason: string }[]> {
    const done: { device: string; type: string; reason: string }[] = [];
    for (const device of this.linked) {
      // A minute of overlap: history is written after the event, so a row can
      // land with a timestamp just behind the last one read. Receipts dedupe it.
      const { events } = await this.ring.history(device.id, device.cursorMs - 60_000);
      for (const row of events) {
        if (row.timestamp < device.linkedAtMs) continue;
        const event = historyToEvent(row, device.id);
        if (!event) continue;
        const out = await this.mantel.ringHistoryEvent(event);
        if (out.reason !== "duplicate") done.push({ device: device.id, type: row.eventType, reason: out.reason });
        device.cursorMs = Math.max(device.cursorMs, row.timestamp);
      }
    }
    for (const d of done) this.log("ring: history", d);
    return done;
  }
}
