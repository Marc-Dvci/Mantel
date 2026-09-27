/**
 * Ring: webhooks in, one snapshot out.
 *
 * Mantel uses three Ring event types and one Ring endpoint:
 *
 *   button_press             the doorbell rang: decide the door card
 *   contact_sensor_faulted   an outside door opened (faulted = the contact is broken = OPEN)
 *   contact_sensor_cleared   it closed
 *   POST /v1/devices/{id}/media/image/download   the frame at the press, for the card
 *
 * Every field name follows the Ring Partner API documentation's v1.1 envelope:
 * {"meta": {"version", "time", "request_id", "account_id"},
 *  "data": {"id", "type", "attributes": {"source", "source_type", "timestamp"}}}.
 * The signature is HMAC-SHA256 over the raw body in `X-Signature`, verified
 * before the body is parsed, and `meta.request_id` makes delivery idempotent.
 * The image download answers 303 with a pre-signed Location, fetched second.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const BUTTON_PRESS = "button_press";
export const MOTION_DETECTED = "motion_detected";
export const CONTACT_FAULTED = "contact_sensor_faulted";
export const CONTACT_CLEARED = "contact_sensor_cleared";

export function sign(body: Buffer | string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Constant-time check of `X-Signature`, accepting the prefixed and bare hex forms. */
export function verifySignature(body: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = sign(body, secret);
  const candidates = [expected, expected.slice("sha256=".length)];
  const got = Buffer.from(header.trim());
  return candidates.some((c) => {
    const want = Buffer.from(c);
    return want.length === got.length && timingSafeEqual(want, got);
  });
}

export interface RingEvent {
  requestId: string;
  accountId?: string;
  type: string;
  deviceId?: string;
  /** Epoch milliseconds. */
  timestamp: number;
  subType?: string;
}

export class RingPayloadError extends Error {}

/** Ring stamps events in epoch milliseconds; tolerate seconds and ISO strings. */
export function epochMs(raw: unknown, fallback: number): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  let v = typeof raw === "number" ? raw : Number(raw);
  if (Number.isNaN(v)) {
    const parsed = Date.parse(String(raw));
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  if (v < 1e11) v *= 1000;
  return v > 0 ? v : fallback;
}

export function parseRingEvent(payload: unknown, receivedAt: number): RingEvent {
  if (!payload || typeof payload !== "object") throw new RingPayloadError("payload is not a JSON object");
  const p = payload as { meta?: Record<string, unknown>; data?: Record<string, unknown>; attributes?: Record<string, unknown>; type?: string };
  const requestId = p.meta?.request_id;
  if (!requestId) throw new RingPayloadError("meta.request_id is required for idempotency");
  const data = p.data ?? {};
  const type = (data.type as string | undefined) ?? p.type;
  if (!type) throw new RingPayloadError("data.type is required");
  const attrs = (data.attributes as Record<string, unknown> | undefined) ?? p.attributes ?? {};
  const deviceId = (attrs.source as string | undefined) ?? (attrs.device_id as string | undefined);
  return {
    requestId: String(requestId),
    ...(p.meta?.account_id ? { accountId: String(p.meta.account_id) } : {}),
    type: String(type),
    ...(deviceId ? { deviceId } : {}),
    timestamp: epochMs(attrs.timestamp, receivedAt),
    ...(attrs.sub_type ? { subType: String(attrs.sub_type) } : {}),
  };
}

/** A v1.1 envelope exactly as the documentation shows it. */
export function envelope(type: string, deviceId: string, timestampMs: number, accountId = "ava1.ring.account.MANTELDEMO", extra: Record<string, unknown> = {}) {
  return {
    meta: { version: "1.1", time: new Date().toISOString(), request_id: randomUUID(), account_id: accountId },
    data: {
      id: `${deviceId}_${type}_${timestampMs}`,
      type,
      attributes: { source: deviceId, source_type: "devices", timestamp: timestampMs, ...extra },
      relationships: { devices: { links: { self: `/v1/devices/${deviceId}` } } },
    },
  };
}

export class RingClient {
  constructor(
    private readonly apiBase: string,
    private readonly token: () => Promise<string | undefined>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * The frame at `atMs`, as JPEG. Two steps: the POST answers 303 with a
   * pre-signed Location, and the GET of that URL returns the image. The
   * redirect is taken by hand so the bearer token is never sent to the
   * pre-signed host.
   */
  async snapshot(deviceId: string, atMs: number): Promise<{ data: Buffer; contentType: string }> {
    const token = await this.token();
    const res = await this.fetchImpl(`${this.apiBase.replace(/\/+$/, "")}/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ type: "at_timestamp", timestamp: Math.floor(atMs), image_options: { format: "jpeg", resolution: { width: 1280, height: 720 } } }),
    });
    let image: Response = res;
    if (res.status === 303 || res.status === 302 || res.status === 307) {
      const location = res.headers.get("location");
      if (!location) throw new Error("Ring snapshot redirect had no Location");
      image = await this.fetchImpl(new URL(location, this.apiBase).toString());
    }
    if (!image.ok) throw new Error(`Ring snapshot ${image.status}: ${(await image.text()).slice(0, 300)}`);
    return { data: Buffer.from(await image.arrayBuffer()), contentType: image.headers.get("content-type") ?? "image/jpeg" };
  }
}
