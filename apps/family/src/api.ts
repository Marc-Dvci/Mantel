/**
 * The family app's client for /api/family.
 */

import type { Alert, Digest, DigestFacts, Guidance, Household, Member, Moment, Message, PlanItem, Topic, TodayBoard } from "../../../packages/core/src";

export interface Overview {
  version: number;
  serverNow: string;
  me: Member;
  household: Household;
  today: TodayBoard;
  presence: { present: boolean; at: string } | null;
  alerts: Alert[];
  unanswered: { text: string; count: number; last: string }[];
  pending: { topics: Topic[]; moments: Moment[]; messages: Message[] };
  digests: string[];
  ringDevices: { id: string; name: string; kind: string }[];
  mediaKey: string;
  drafts: boolean;
  speech: boolean;
}

export interface Drafted {
  text: string;
  source: "model" | "template";
  problems: string[];
}

const TOKEN_KEY = "mantel.family.token";

export function savedToken(): string | undefined {
  const fromUrl = new URLSearchParams(location.search).get("token");
  if (fromUrl) {
    localStorage.setItem(TOKEN_KEY, fromUrl);
    history.replaceState(null, "", location.pathname + location.hash);
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_KEY) ?? undefined;
}

export function saveToken(t: string | undefined) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class Api {
  constructor(readonly token: string) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`/api/family${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
    const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
    if (!res.ok) throw new ApiError(res.status, (body as { error?: string })?.error ?? `Request failed (${res.status})`);
    return body as T;
  }

  overview = () => this.req<Overview>("/overview");
  wait = (since: number) => this.req<{ version: number }>(`/wait?since=${since}&wait=20000`);

  addPlan = (p: Omit<PlanItem, "id">) => this.req<PlanItem>("/plan", { method: "POST", body: JSON.stringify(p) });
  removePlan = (id: string) => this.req(`/plan/${id}`, { method: "DELETE" });
  markDone = (id: string, done: boolean) => this.req<PlanItem>(`/plan/${id}/done`, { method: "POST", body: JSON.stringify({ done }) });
  setUnusual = (date: string, unusual: boolean) => this.req(`/unusual`, { method: "POST", body: JSON.stringify({ date, unusual }) });

  guidance = () => this.req<Guidance[]>("/guidance");
  createTopic = (t: Partial<Topic>) => this.req<Topic>("/topics", { method: "POST", body: JSON.stringify(t) });
  updateTopic = (id: string, t: Partial<Topic>) => this.req<Topic>(`/topics/${id}`, { method: "PUT", body: JSON.stringify(t) });
  removeTopic = (id: string) => this.req(`/topics/${id}`, { method: "DELETE" });
  approve = (kind: "topics" | "moments" | "messages", id: string) => this.req(`/${kind}/${id}/approve`, { method: "POST" });
  remove = (kind: "topics" | "moments" | "messages", id: string) => this.req(`/${kind}/${id}`, { method: "DELETE" });

  upload = (blob: Blob) => this.req<{ id: string }>("/media", { method: "POST", body: blob, headers: { "content-type": blob.type || "application/octet-stream" } });
  createMoment = (m: Omit<Partial<Moment>, "story"> & { story?: { text: string; audio?: string } }) => this.req<Moment>("/moments", { method: "POST", body: JSON.stringify(m) });
  createMessage = (m: Omit<Message, "id" | "from">) => this.req<Message>("/messages", { method: "POST", body: JSON.stringify(m) });

  draftCaption = (c: { people: string[]; place?: string; year?: string; note?: string }) => this.req<Drafted>("/drafts/caption", { method: "POST", body: JSON.stringify(c) });
  draftAnswer = (text: string, policy: string) => this.req<Drafted>("/drafts/answer", { method: "POST", body: JSON.stringify({ text, policy }) });

  ack = (id: string) => this.req(`/alerts/${id}/ack`, { method: "POST" });
  digest = (date: string) => this.req<Digest & { facts: DigestFacts }>(`/digest/${date}`);
  settings = (s: Partial<Household["settings"]>) => this.req(`/settings`, { method: "PUT", body: JSON.stringify(s) });
  privacy = () => this.req<{ stored: { events: number; byType: Record<string, number>; oldest: string | null }; leavesTheTv: string[]; neverLeavesTheTv: string[] }>("/privacy");
  erase = () => this.req<{ erased: number }>("/privacy/erase", { method: "POST" });
  pairCode = () => this.req<{ code: string; expiresAt: string }>("/tv/pair-code", { method: "POST" });
}

export function mediaUrl(o: Overview | undefined, id: string | undefined): string | undefined {
  return o && id ? `/media/${o.household.id}/${encodeURIComponent(id)}?k=${o.mediaKey}` : undefined;
}
