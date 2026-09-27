/**
 * Storage.
 *
 * One document per household holds everything the TV and the family read
 * (the household record, alerts, the active door card, digests), versioned so
 * the TV can long-poll on the version number. Events are append-only and kept
 * apart, because they are the bulk of the data and are only ever read by date
 * range. Two implementations share this interface: files on disk for local
 * runs, and DynamoDB (see dynamo.ts).
 */

import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Alert, Digest, DoorCard, Household, MantelEvent } from "../../../packages/core/src";

export type Principal = { kind: "member"; memberId: string } | { kind: "tv"; deviceName: string };

export interface RingDevice {
  id: string;
  name: string;
  kind: "doorbell" | "contact";
  outside?: boolean;
}

export interface HouseholdState {
  household: Household;
  version: number;
  alerts: Alert[];
  doorCard?: DoorCard;
  digests: Record<string, Digest>;
  /** Care days the Change Signal has already read. */
  evaluated: string[];
  tokens: Record<string, Principal>;
  pairCodes: { code: string; expiresAt: string }[];
  presence: { present: boolean; since?: string; lastSeen?: string };
  ringDevices: RingDevice[];
}

export interface Store {
  households(): Promise<string[]>;
  get(hid: string): Promise<HouseholdState | undefined>;
  /** Create or replace. */
  put(hid: string, state: HouseholdState): Promise<void>;
  /** Read, change, write back with a version check; retried on conflict. Bumps the version. */
  update<T>(hid: string, fn: (s: HouseholdState) => T): Promise<{ state: HouseholdState; result: T }>;
  addEvents(hid: string, events: MantelEvent[]): Promise<void>;
  events(hid: string, fromIso: string, toIso: string): Promise<MantelEvent[]>;
  deleteEvents(hid: string): Promise<number>;
  /** True the first time a key is seen: Ring request ids, for idempotency. */
  recordReceipt(key: string): Promise<boolean>;
  findToken(token: string): Promise<{ hid: string; principal: Principal } | undefined>;
  saveToken(hid: string, token: string, principal: Principal): Promise<void>;
  /** Resolves with the current version as soon as it exceeds `since`, or after `ms`. */
  waitForVersion(hid: string, since: number, ms: number): Promise<number>;
}

const MAX_ALERTS = 200;
const MAX_DIGESTS = 45;

/** Keeps the state document small enough for a single DynamoDB item. */
export function trim(s: HouseholdState): HouseholdState {
  if (s.alerts.length > MAX_ALERTS) s.alerts = s.alerts.slice(-MAX_ALERTS);
  const dates = Object.keys(s.digests).sort();
  for (const d of dates.slice(0, Math.max(0, dates.length - MAX_DIGESTS))) delete s.digests[d];
  if (s.evaluated.length > 120) s.evaluated = s.evaluated.slice(-120);
  const now = Date.now();
  s.pairCodes = s.pairCodes.filter((p) => Date.parse(p.expiresAt) > now);
  return s;
}

export class LocalStore implements Store {
  private readonly states = new Map<string, HouseholdState>();
  private readonly eventLog = new Map<string, MantelEvent[]>();
  private readonly receipts = new Set<string>();
  private readonly bus = new EventEmitter();
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(private readonly dir?: string) {
    this.bus.setMaxListeners(1000);
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".state.json")) {
        const hid = f.replace(/\.state\.json$/, "");
        this.states.set(hid, JSON.parse(readFileSync(join(dir, f), "utf8")) as HouseholdState);
        const ev = join(dir, `${hid}.events.jsonl`);
        this.eventLog.set(
          hid,
          existsSync(ev) ? readFileSync(ev, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as MantelEvent) : [],
        );
      }
    }
  }

  async households() {
    return [...this.states.keys()];
  }

  async get(hid: string) {
    const s = this.states.get(hid);
    return s ? structuredClone(s) : undefined;
  }

  async put(hid: string, state: HouseholdState) {
    this.states.set(hid, structuredClone(trim(state)));
    this.persist(true);
    this.bus.emit(`v:${hid}`, state.version);
  }

  async update<T>(hid: string, fn: (s: HouseholdState) => T) {
    const current = this.states.get(hid);
    if (!current) throw new Error(`No household ${hid}`);
    const draft = structuredClone(current);
    const result = fn(draft);
    draft.version = current.version + 1;
    this.states.set(hid, trim(draft));
    this.persist(false);
    this.bus.emit(`v:${hid}`, draft.version);
    return { state: structuredClone(draft), result };
  }

  async addEvents(hid: string, events: MantelEvent[]) {
    const log = this.eventLog.get(hid) ?? [];
    log.push(...events);
    this.eventLog.set(hid, log);
    if (this.dir && events.length) {
      appendFileSync(join(this.dir, `${hid}.events.jsonl`), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    }
  }

  async events(hid: string, fromIso: string, toIso: string) {
    return (this.eventLog.get(hid) ?? []).filter((e) => e.at >= fromIso && e.at < toIso).sort((a, b) => a.at.localeCompare(b.at));
  }

  async deleteEvents(hid: string) {
    const n = this.eventLog.get(hid)?.length ?? 0;
    this.eventLog.set(hid, []);
    if (this.dir) writeFileSync(join(this.dir, `${hid}.events.jsonl`), "");
    return n;
  }

  async recordReceipt(key: string) {
    if (this.receipts.has(key)) return false;
    this.receipts.add(key);
    return true;
  }

  async findToken(token: string) {
    for (const [hid, s] of this.states) {
      const principal = s.tokens[token];
      if (principal) return { hid, principal };
    }
    return undefined;
  }

  async saveToken(hid: string, token: string, principal: Principal) {
    await this.update(hid, (s) => {
      s.tokens[token] = principal;
    });
  }

  waitForVersion(hid: string, since: number, ms: number): Promise<number> {
    const now = this.states.get(hid)?.version ?? 0;
    if (now > since) return Promise.resolve(now);
    return new Promise((resolveWait) => {
      const done = (v: number) => {
        clearTimeout(timer);
        this.bus.off(`v:${hid}`, onBump);
        resolveWait(v);
      };
      const onBump = (v: number) => {
        if (v > since) done(v);
      };
      const timer = setTimeout(() => done(this.states.get(hid)?.version ?? since), ms);
      this.bus.on(`v:${hid}`, onBump);
    });
  }

  /** Writes the state file; debounced for updates, immediate for puts. */
  private persist(now: boolean) {
    if (!this.dir) return;
    const write = () => {
      for (const [id, s] of this.states) writeFileSync(join(this.dir!, `${id}.state.json`), JSON.stringify(s));
    };
    if (now) return write();
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(write, 200);
    this.flushTimer.unref?.();
  }
}
