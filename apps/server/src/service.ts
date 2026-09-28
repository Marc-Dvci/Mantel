/**
 * The Mantel service: every rule from packages/core, wired to storage, Ring,
 * media and the clock.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  addDays,
  changeAlert,
  computeToday,
  dayFeatures,
  decideDoor,
  digestFacts,
  localParts,
  makeDigest,
  median,
  nightDoorAlert,
  nightPresenceAlert,
  parseClock,
  runSignal,
  zonedInstant,
  type Alert,
  type DayFeatures,
  type Household,
  type MantelEvent,
  type Member,
} from "../../../packages/core/src";
import type { Config } from "./config";
import { speechMediaId, type ModelClient, type Voice } from "./language";
import { mediaKey, newMediaId, type MediaStore } from "./media";
import {
  BUTTON_PRESS,
  CONTACT_CLEARED,
  CONTACT_FAULTED,
  MOTION_DETECTED,
  parseRingEvent,
  RingPayloadError,
  verifySignature,
  type RingClient,
  type RingEvent,
} from "./ring";
import type { HouseholdState, Principal, Store } from "./store";

/** A clock that can be moved for the demo and ticks normally from where it is set. */
export class Clock {
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  setTo(at: Date) {
    this.offsetMs = at.getTime() - Date.now();
  }
  reset() {
    this.offsetMs = 0;
  }
  get offset() {
    return this.offsetMs;
  }
}

export interface Deps {
  config: Config;
  store: Store;
  media: MediaStore;
  ring: RingClient;
  clock: Clock;
  model?: ModelClient | undefined;
  voice?: Voice | undefined;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The part of the household the TV needs, and nothing more. */
export function tvHousehold(h: Household, today: string): Household {
  return {
    ...h,
    plan: h.plan.filter((p) => p.date >= addDays(today, -1) && p.date <= addDays(today, 14)),
    topics: h.topics.filter((t) => t.approvedBy),
    moments: h.moments.filter((m) => m.approvedBy),
    messages: h.messages.filter((m) => m.approvedBy && !m.playedAt && m.schedule.date >= today),
  };
}

export class Mantel {
  constructor(readonly deps: Deps) {}

  get clock() {
    return this.deps.clock;
  }

  private log(msg: string, extra?: Record<string, unknown>) {
    this.deps.log?.(msg, extra);
  }

  async state(hid: string): Promise<HouseholdState> {
    const s = await this.deps.store.get(hid);
    if (!s) throw new HttpError(404, "No such household");
    return s;
  }

  async authenticate(token: string | undefined): Promise<{ hid: string; principal: Principal }> {
    if (!token) throw new HttpError(401, "Sign in first");
    const found = await this.deps.store.findToken(token);
    if (!found) throw new HttpError(401, "Unknown token");
    return found;
  }

  // ---------------------------------------------------------------- the TV

  async tvState(hid: string, since: number, waitMs: number) {
    if (waitMs > 0) await this.deps.store.waitForVersion(hid, since, waitMs);
    const s = await this.state(hid);
    const now = this.clock.now();
    const today = localParts(now, s.household.settings.timezone).date;
    const door = s.doorCard && Date.parse(s.doorCard.expiresAt) > now.getTime() ? s.doorCard : undefined;
    return {
      version: s.version,
      serverNow: now.toISOString(),
      household: tvHousehold(s.household, today),
      ...(door ? { doorCard: door } : {}),
      mediaKey: mediaKey(this.deps.config.secret, hid),
      speech: Boolean(this.deps.voice),
      ...(this.deps.config.demo && s.devInput ? { devInput: s.devInput } : {}),
    };
  }

  /** Events the TV sends: presence, questions, what it showed and played. */
  async tvEvents(hid: string, incoming: MantelEvent[]) {
    const now = this.clock.now();
    const events = incoming.map((e) => ({ ...e, id: e.id || randomUUID(), at: e.at || now.toISOString() }));
    await this.deps.store.addEvents(hid, events);
    const played = events.filter((e) => e.type === "message.played").map((e) => String(e.data?.id ?? ""));
    const nightStarts = events.filter((e) => e.type === "presence.start");
    const s = await this.state(hid);
    const alerts = nightStarts
      .map((e) => nightPresenceAlert(s.household, new Date(e.at), e.id))
      .filter((a): a is Alert => Boolean(a));
    if (played.length || alerts.length) {
      await this.deps.store.update(hid, (st) => {
        for (const m of st.household.messages) if (played.includes(m.id) && !m.playedAt) m.playedAt = now.toISOString();
        st.alerts.push(...alerts);
      });
    }
    return { accepted: events.length };
  }

  /** Speech for a line, in the household voice, made once and cached as media. */
  async speech(hid: string, text: string): Promise<{ data: Buffer; contentType: string } | undefined> {
    const voice = this.deps.voice;
    if (!voice || !text.trim() || text.length > 400) return undefined;
    const id = speechMediaId(voice, text);
    const cached = await this.deps.media.get(hid, id);
    if (cached) return cached;
    const data = await voice.synthesize(text);
    await this.deps.media.put(hid, id, data, "audio/mpeg");
    return { data, contentType: "audio/mpeg" };
  }

  // ---------------------------------------------------------------- Ring

  /**
   * The webhook path does only what must happen inside Ring's five seconds:
   * verify, dedupe, decide the card, store. The snapshot is fetched after the
   * response, and the card is updated with it when it lands.
   */
  async ringWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ status: number; reason: string; after?: () => Promise<void> }> {
    if (!verifySignature(rawBody, signature, this.deps.config.ring.webhookSecret)) return { status: 401, reason: "bad signature" };
    let event;
    try {
      event = parseRingEvent(JSON.parse(rawBody.toString("utf8")), this.clock.now().getTime());
    } catch (err) {
      return { status: 400, reason: err instanceof RingPayloadError ? err.message : "malformed JSON" };
    }
    if (!(await this.deps.store.recordReceipt(`ring:${event.requestId}`))) return { status: 200, reason: "duplicate" };
    return this.ringEvent(event);
  }

  /**
   * An event read from the account's event history rather than pushed to the
   * webhook: the same decision, the same idempotency key space, and the frame
   * fetched straight away since there is no five-second reply to protect.
   */
  async ringHistoryEvent(event: RingEvent): Promise<{ status: number; reason: string }> {
    if (!(await this.deps.store.recordReceipt(`ring:${event.requestId}`))) return { status: 200, reason: "duplicate" };
    const out = await this.ringEvent(event);
    await out.after?.();
    return { status: out.status, reason: out.reason };
  }

  /** What a Ring event means for the household, whichever way it arrived. */
  private async ringEvent(event: RingEvent): Promise<{ status: number; reason: string; after?: () => Promise<void> }> {
    const hid = await this.householdForRingDevice(event.deviceId);
    if (!hid) return { status: 200, reason: "device not linked to a household" };
    const at = new Date(event.timestamp);

    if (event.type === BUTTON_PRESS) {
      const id = `door-${event.timestamp}`;
      const { result: decision } = await this.deps.store.update(hid, (s) => {
        const d = decideDoor(s.household, at, id);
        s.doorCard = d.card;
        s.alerts.push(d.alert);
        return d;
      });
      await this.deps.store.addEvents(hid, [{ id, at: at.toISOString(), type: "door.press", data: { kind: decision.card.kind, device: event.deviceId } }]);
      this.log("door", { kind: decision.card.kind, at: at.toISOString() });
      return { status: 200, reason: `door card: ${decision.card.kind}`, after: () => this.attachSnapshot(hid, id, event.deviceId!, event.timestamp) };
    }

    if (event.type === CONTACT_FAULTED || event.type === CONTACT_CLEARED) {
      const s = await this.state(hid);
      const device = s.ringDevices.find((d) => d.id === event.deviceId);
      const id = `contact-${event.timestamp}`;
      const type = event.type === CONTACT_FAULTED ? "contact.open" : "contact.close";
      if (!device?.outside) return { status: 200, reason: "not an outside door" };
      await this.deps.store.addEvents(hid, [{ id, at: at.toISOString(), type, data: { sensor: device.name } }]);
      if (type === "contact.open") {
        const alert = nightDoorAlert(s.household, at, id, device.name);
        if (alert) await this.deps.store.update(hid, (st) => void st.alerts.push(alert));
        return { status: 200, reason: alert ? "night door alert" : "door opened" };
      }
      return { status: 200, reason: "door closed" };
    }

    if (event.type === MOTION_DETECTED) {
      if (event.subType === "human") {
        await this.deps.store.addEvents(hid, [{ id: `motion-${event.timestamp}`, at: at.toISOString(), type: "door.motion" }]);
      }
      return { status: 200, reason: "motion noted" };
    }
    return { status: 200, reason: `ignored ${event.type}` };
  }

  private async householdForRingDevice(deviceId: string | undefined): Promise<string | undefined> {
    if (!deviceId) return undefined;
    for (const hid of await this.deps.store.households()) {
      const s = await this.deps.store.get(hid);
      if (s?.ringDevices.some((d) => d.id === deviceId)) return hid;
    }
    return undefined;
  }

  async attachSnapshot(hid: string, doorId: string, deviceId: string, atMs: number) {
    try {
      const img = await this.deps.ring.snapshot(deviceId, atMs);
      const mediaId = `snapshot-${atMs}`;
      await this.deps.media.put(hid, mediaId, img.data, img.contentType);
      await this.deps.store.update(hid, (s) => {
        if (s.doorCard?.id === doorId) s.doorCard.snapshot = mediaId;
        const alert = s.alerts.find((a) => a.id === `alert-${doorId}`);
        if (alert) alert.snapshot = mediaId;
      });
    } catch (err) {
      this.log("snapshot failed", { error: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------- family

  member(s: HouseholdState, principal: Principal): Member {
    if (principal.kind !== "member") throw new HttpError(403, "Family members only");
    const m = s.household.members.find((x) => x.id === principal.memberId);
    if (!m) throw new HttpError(403, "Not a member of this household");
    return m;
  }

  requirePrimary(s: HouseholdState, principal: Principal): Member {
    const m = this.member(s, principal);
    if (m.role !== "primary") throw new HttpError(403, "Only the primary caregiver can approve");
    return m;
  }

  /** Everything the family's home screen shows. */
  async overview(hid: string, principal: Principal) {
    const s = await this.state(hid);
    const me = this.member(s, principal);
    const now = this.clock.now();
    const tz = s.household.settings.timezone;
    const today = localParts(now, tz).date;
    const since = zonedInstant(addDays(today, -6), "00:00", tz).toISOString();
    const recent = await this.deps.store.events(hid, since, now.toISOString());
    const lastPresence = [...recent].reverse().find((e) => e.type === "presence.start" || e.type === "presence.end");
    const unanswered = new Map<string, { text: string; count: number; last: string }>();
    for (const e of recent.filter((x) => x.type === "question" && !x.data?.topicId)) {
      const text = String(e.data?.text ?? "").trim();
      const key = text.toLowerCase();
      const u = unanswered.get(key) ?? { text, count: 0, last: e.at };
      u.count++;
      u.last = e.at;
      unanswered.set(key, u);
    }
    const pending = {
      topics: s.household.topics.filter((t) => !t.approvedBy),
      moments: s.household.moments.filter((m) => !m.approvedBy),
      messages: s.household.messages.filter((m) => !m.approvedBy),
    };
    return {
      version: s.version,
      serverNow: now.toISOString(),
      me,
      household: s.household,
      today: computeToday(s.household, now),
      presence: lastPresence ? { present: lastPresence.type === "presence.start", at: lastPresence.at } : null,
      alerts: [...s.alerts].reverse().slice(0, 30),
      unanswered: [...unanswered.values()].sort((a, b) => b.count - a.count),
      pending,
      digests: Object.keys(s.digests).sort().reverse().slice(0, 7),
      ringDevices: s.ringDevices,
      mediaKey: mediaKey(this.deps.config.secret, hid),
      drafts: Boolean(this.deps.model),
      speech: Boolean(this.deps.voice),
    };
  }

  async edit<T>(hid: string, principal: Principal, fn: (h: Household, me: Member, s: HouseholdState) => T): Promise<T> {
    const { result } = await this.deps.store.update(hid, (s) => fn(s.household, this.member(s, principal), s));
    return result;
  }

  async newPairCode(hid: string, principal: Principal) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    await this.deps.store.update(hid, (s) => {
      this.requirePrimary(s, principal);
      s.pairCodes.push({ code, expiresAt });
    });
    return { code, expiresAt };
  }

  async pairTv(code: string, deviceName: string) {
    for (const hid of await this.deps.store.households()) {
      const s = await this.deps.store.get(hid);
      if (s?.pairCodes.some((p) => p.code === code && Date.parse(p.expiresAt) > Date.now())) {
        const token = `tv_${randomBytes(18).toString("hex")}`;
        await this.deps.store.saveToken(hid, token, { kind: "tv", deviceName });
        await this.deps.store.update(hid, (st) => {
          st.pairCodes = st.pairCodes.filter((p) => p.code !== code);
        });
        return { token, household: hid };
      }
    }
    throw new HttpError(404, "That code is not valid. Ask for a new one in the family app.");
  }

  async uploadMedia(hid: string, data: Buffer, contentType: string, prefix: string) {
    if (data.length > 25 * 1024 * 1024) throw new HttpError(413, "Files up to 25 MB");
    const id = newMediaId(prefix);
    await this.deps.media.put(hid, id, data, contentType);
    return { id };
  }

  // ---------------------------------------------------------------- the day's rhythm

  /** Care-day features for the `n` days ending `lastDate`, from stored events. */
  async features(hid: string, h: Household, lastDate: string, n: number): Promise<DayFeatures[]> {
    const tz = h.settings.timezone;
    const first = addDays(lastDate, -(n - 1));
    const from = zonedInstant(first, "00:00", tz).toISOString();
    const to = zonedInstant(addDays(lastDate, 2), "00:00", tz).toISOString();
    const events = await this.deps.store.events(hid, from, to);
    const nowMs = this.clock.now().getTime();
    return Array.from({ length: n }, (_, i) => dayFeatures(h, events, addDays(first, i), nowMs));
  }

  /**
   * Runs every few minutes. Idempotent: each step records that it ran.
   *  - expire the door card
   *  - an hour after the planned waking time, read yesterday's care day with the Change Signal
   *  - at 20:00, write the day's digest
   */
  async tick(hid: string) {
    const now = this.clock.now();
    const s = await this.state(hid);
    const h = s.household;
    const tz = h.settings.timezone;
    const p = localParts(now, tz);
    const done: string[] = [];

    if (s.doorCard && Date.parse(s.doorCard.expiresAt) <= now.getTime()) {
      await this.deps.store.update(hid, (st) => {
        delete st.doorCard;
      });
      done.push("door card expired");
    }

    const yesterday = addDays(p.date, -1);
    if (p.minuteOfDay >= parseClock(h.settings.wake) + 60 && !s.evaluated.includes(yesterday)) {
      const history = await this.features(hid, h, yesterday, 40);
      const decisions = runSignal(history);
      const last = decisions.at(-1)!;
      await this.deps.store.update(hid, (st) => {
        st.evaluated.push(yesterday);
        if (last.alert && !st.alerts.some((a) => a.id === `change-${last.date}`)) st.alerts.push(changeAlert(st.household, last, now));
      });
      done.push(`signal read ${yesterday}${last.alert ? ": alert" : ""}`);
    }

    if (p.minuteOfDay >= parseClock("20:00") && !s.digests[p.date]) {
      await this.makeDigest(hid, p.date);
      done.push(`digest ${p.date}`);
    }
    return done;
  }

  async makeDigest(hid: string, date: string) {
    const s = await this.state(hid);
    const h = s.household;
    const tz = h.settings.timezone;
    const from = zonedInstant(addDays(date, -1), "00:00", tz).toISOString();
    const to = zonedInstant(addDays(date, 2), "00:00", tz).toISOString();
    const events = await this.deps.store.events(hid, from, to);
    const history = await this.features(hid, h, addDays(date, -1), 28);
    const qs = history.filter((d) => !d.unusual && d.questions !== null).map((d) => d.questions!);
    const facts = digestFacts(h, events, date, this.clock.now().getTime(), qs.length >= 7 ? { questions: median(qs) } : undefined);
    const digest = makeDigest(facts);
    await this.deps.store.update(hid, (st) => {
      st.digests[date] = digest;
    });
    return digest;
  }
}
