/**
 * The TV's link to the household.
 *
 * A long-poll keeps the TV within a second of every change (a door card, an
 * approved answer). The last state is cached, so a TV that loses its network
 * still shows the day, the time and the family's answers. Events wait in a
 * persisted queue until the server takes them.
 */

import type { DoorCard, Household, MantelEvent } from "../../../packages/core/src";
import { native } from "./bridge";

export interface TvState {
  version: number;
  serverNow: string;
  household: Household;
  doorCard?: DoorCard;
  mediaKey: string;
  speech: boolean;
}

export interface Settings {
  server: string;
  token: string;
}

const STATE_KEY = "mantel.state";
const QUEUE_KEY = "mantel.queue";

function read<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the cache is a convenience */
  }
}

/** Native config first, then the URL, then the page's own origin. */
export function resolveSettings(): Settings | undefined {
  const n = native.config();
  const q = new URLSearchParams(location.search);
  const server = (n.server ?? q.get("server") ?? (location.protocol.startsWith("http") ? location.origin : "")).replace(/\/+$/, "");
  const token = n.token ?? q.get("token") ?? "";
  return server && token ? { server, token } : undefined;
}

export class Connection {
  private offsetMs = 0;
  private stopped = false;
  private last?: TvState = read<TvState>(STATE_KEY);
  private queue: MantelEvent[] = read<MantelEvent[]>(QUEUE_KEY) ?? [];
  online = false;

  constructor(
    readonly settings: Settings,
    private readonly onState: (s: TvState) => void,
    private readonly onOnline: (online: boolean) => void,
  ) {
    if (this.last) {
      this.offsetMs = read<number>("mantel.offset") ?? 0;
      queueMicrotask(() => this.onState(this.last!));
    }
  }

  now(): number {
    return Date.now() + this.offsetMs;
  }

  mediaUrl(id: string | undefined): string | undefined {
    if (!id || !this.last) return undefined;
    return `${this.settings.server}/media/${this.last.household.id}/${encodeURIComponent(id)}?k=${this.last.mediaKey}`;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.settings.token}` };
  }

  async start() {
    let since = -1;
    let backoff = 1000;
    let first = true;
    while (!this.stopped) {
      try {
        const res = await fetch(`${this.settings.server}/api/tv/state?since=${since}&wait=${first ? 0 : 20000}`, { headers: this.headers() });
        if (!res.ok) throw new Error(`state ${res.status}`);
        const s = (await res.json()) as TvState;
        this.offsetMs = Date.parse(s.serverNow) - Date.now();
        write("mantel.offset", this.offsetMs);
        write(STATE_KEY, s);
        this.last = s;
        since = s.version;
        first = false;
        backoff = 1000;
        if (!this.online) {
          this.online = true;
          this.onOnline(true);
        }
        this.onState(s);
        void this.flush();
      } catch {
        if (this.online) {
          this.online = false;
          this.onOnline(false);
        }
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(30_000, backoff * 2);
      }
    }
  }

  stop() {
    this.stopped = true;
  }

  send(type: MantelEvent["type"], data?: Record<string, unknown>) {
    this.queue.push({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, at: new Date(this.now()).toISOString(), type, ...(data ? { data } : {}) });
    if (this.queue.length > 500) this.queue = this.queue.slice(-500);
    write(QUEUE_KEY, this.queue);
    void this.flush();
  }

  private flushing = false;
  async flush() {
    if (this.flushing || !this.queue.length) return;
    this.flushing = true;
    const batch = this.queue.slice(0, 100);
    try {
      const res = await fetch(`${this.settings.server}/api/tv/events`, {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
      });
      if (res.ok) {
        const sent = new Set(batch.map((e) => e.id));
        this.queue = this.queue.filter((e) => !sent.has(e.id));
        write(QUEUE_KEY, this.queue);
      }
    } catch {
      /* kept for the next flush */
    } finally {
      this.flushing = false;
    }
    if (this.queue.length && this.online) setTimeout(() => void this.flush(), 2000);
  }

  /** The household voice for a line, or undefined when the server has none. */
  async speechUrl(text: string): Promise<string | undefined> {
    if (!this.last?.speech) return undefined;
    try {
      const res = await fetch(`${this.settings.server}/api/tv/speech?text=${encodeURIComponent(text)}`, { headers: this.headers() });
      if (!res.ok) return undefined;
      return URL.createObjectURL(await res.blob());
    } catch {
      return undefined;
    }
  }
}
