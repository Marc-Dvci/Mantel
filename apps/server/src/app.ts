/**
 * HTTP surface.
 *
 *   /api/tv/*       the Fire TV app: state (long-poll), events, speech, pairing
 *   /api/family/*   the family web app
 *   /ring/webhook   Ring's signed webhooks
 *   /media/*        photos, recordings, snapshots, behind a household key
 *   /api/dev/*      demo only: move the clock, ring the simulated doorbell
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  GUIDANCE,
  localParts,
  newTopicId,
  zonedInstant,
  type Member,
  type Message,
  type Moment,
  type PlanItem,
  type Topic,
} from "../../../packages/core/src";
import { draftAnswer, draftCaption } from "./language";
import { mediaKey } from "./media";
import type { RingSimulator, Visitor } from "./ringsim";
import { seedDemo } from "./seed";
import { HttpError, type Mantel } from "./service";
import type { Principal } from "./store";

type Authed = Request & { hid: string; principal: Principal };

const wrap =
  (fn: (req: Authed, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req as Authed, res).then((out) => {
      if (out !== undefined && !res.headersSent) res.json(out);
    }, next);

function bearer(req: Request): string | undefined {
  const h = req.header("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

const planBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{1,2}:\d{2}$/),
  until: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  kind: z.enum(["visit", "meal", "pills", "outing", "call", "delivery", "other"]),
  title: z.string().min(1).max(80),
  who: z.string().optional(),
});

const topicBody = z.object({
  label: z.string().min(1).max(60),
  phrasings: z.array(z.string().min(2).max(120)).min(1).max(30),
  policy: z.enum(["tell", "redirect", "comfort"]),
  answer: z.string().max(300),
  fallback: z.string().max(300).optional(),
  photo: z.string().optional(),
  audio: z.string().optional(),
  entities: z.array(z.string()).optional(),
  statements: z.boolean().optional(),
  expiresAt: z.string().optional(),
});

const momentBody = z.object({
  photo: z.string().min(1),
  caption: z.string().min(1).max(160),
  year: z.string().max(10).optional(),
  people: z.array(z.string()).default([]),
  calm: z.boolean().default(true),
  story: z.object({ text: z.string().max(400), audio: z.string().optional() }).optional(),
});

const messageBody = z.object({
  media: z.string().min(1),
  mediaKind: z.enum(["video", "audio"]),
  text: z.string().min(1).max(300),
  schedule: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("first-seen-after"), date: z.string(), time: z.string() }),
    z.object({ kind: z.literal("at"), date: z.string(), time: z.string() }),
    z.object({ kind: z.literal("evening-end"), date: z.string() }),
  ]),
});

const settingsBody = z.object({
  wake: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  bedtime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  evening: z.object({ start: z.string(), end: z.string() }).optional(),
  listening: z.enum(["questions", "name", "off"]).optional(),
  visitWindowMinutes: z.number().int().min(10).max(180).optional(),
  answerSeconds: z.number().int().min(8).max(90).optional(),
  nightAlerts: z.object({ doorOpen: z.boolean(), presence: z.boolean() }).optional(),
  homeLine: z.string().max(80).optional(),
  nightLines: z.array(z.string().max(80)).max(4).optional(),
});

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? String(v[0]) : String(v ?? "");
}

function isPrimary(m: Member) {
  return m.role === "primary";
}

function approval(me: Member, at: string) {
  return isPrimary(me) ? { approvedBy: me.id, approvedAt: at } : {};
}

function find<T extends { id: string }>(xs: T[], id: string, what: string): T {
  const x = xs.find((i) => i.id === id);
  if (!x) throw new HttpError(404, `No such ${what}`);
  return x;
}

export interface AppOptions {
  webRoot?: string;
  sim?: RingSimulator;
  /** Called after the response, for work outside Ring's five-second window. */
  defer?: (work: () => Promise<void>) => void;
}

export function createApp(mantel: Mantel, opts: AppOptions = {}) {
  const app = express();
  const { config, store, media } = mantel.deps;
  const defer = opts.defer ?? ((w) => void w().catch(() => undefined));
  app.disable("x-powered-by");

  // The Fire TV app loads its interface from the APK's own asset origin, so the
  // TV routes answer cross-origin requests. They are bearer-token or key protected.
  app.use(["/api/tv", "/media"], (req, res, next) => {
    res.set("access-control-allow-origin", "*");
    res.set("access-control-allow-headers", "authorization, content-type");
    res.set("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Ring's signature covers the raw bytes, so this route reads them before any JSON parser.
  app.post("/ring/webhook", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
    const out = await mantel.ringWebhook(req.body as Buffer, req.header("x-signature"));
    res.status(out.status).json({ reason: out.reason });
    if (out.after) defer(out.after);
  });

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, demo: config.demo, store: config.store, media: config.media, drafts: Boolean(mantel.deps.model), speech: Boolean(mantel.deps.voice) });
  });

  // ------------------------------------------------------------ media
  app.get("/media/:hid/:id", async (req, res, next) => {
    try {
      if (req.query.k !== mediaKey(config.secret, req.params.hid)) {
        res.status(403).end();
        return;
      }
      const obj = await media.get(req.params.hid, req.params.id);
      if (!obj) {
        res.status(404).end();
        return;
      }
      res.set("cache-control", "private, max-age=86400").type(obj.contentType).send(obj.data);
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ TV
  app.post(
    "/api/tv/pair",
    wrap(async (req) => {
      const body = z.object({ code: z.string().regex(/^\d{6}$/), name: z.string().max(60).default("Living room TV") }).parse(req.body);
      return mantel.pairTv(body.code, body.name);
    }),
  );

  const requireKind =
    (kind: Principal["kind"]) =>
    (req: Request, _res: Response, next: NextFunction) => {
      mantel
        .authenticate(bearer(req))
        .then(({ hid, principal }) => {
          if (principal.kind !== kind) throw new HttpError(403, kind === "tv" ? "TV token required" : "Family token required");
          (req as Authed).hid = hid;
          (req as Authed).principal = principal;
          next();
        })
        .catch(next);
    };
  const asTv = requireKind("tv");

  app.get(
    "/api/tv/state",
    asTv,
    wrap(async (req) => {
      const since = Number(req.query.since ?? -1);
      const wait = Math.min(25_000, Number(req.query.wait ?? 0));
      return mantel.tvState(req.hid, since, wait);
    }),
  );

  app.post(
    "/api/tv/events",
    asTv,
    wrap(async (req) => {
      const body = z
        .object({
          events: z
            .array(z.object({ id: z.string().default(""), at: z.string().default(""), type: z.string(), data: z.record(z.string(), z.unknown()).optional() }))
            .max(200),
        })
        .parse(req.body);
      return mantel.tvEvents(req.hid, body.events as never);
    }),
  );

  app.get("/api/tv/speech", asTv, async (req, res, next) => {
    try {
      const out = await mantel.speech((req as Authed).hid, String(req.query.text ?? ""));
      if (!out) {
        res.status(404).end();
        return;
      }
      res.set("cache-control", "private, max-age=86400").type(out.contentType).send(out.data);
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ family
  const f = express.Router();
  f.use(requireKind("member"));

  f.get("/overview", wrap(async (req) => mantel.overview(req.hid, req.principal)));

  f.get(
    "/wait",
    wrap(async (req) => {
      const v = await store.waitForVersion(req.hid, Number(req.query.since ?? -1), Math.min(25_000, Number(req.query.wait ?? 20_000)));
      return { version: v };
    }),
  );

  const now = () => mantel.clock.now().toISOString();

  f.post(
    "/plan",
    wrap(async (req) => {
      const body = planBody.parse(req.body);
      return mantel.edit(req.hid, req.principal, (h) => {
        const item: PlanItem = { id: `plan-${Date.now().toString(36)}`, ...body };
        h.plan.push(item);
        return item;
      });
    }),
  );

  f.put(
    "/plan/:id",
    wrap(async (req) => {
      const body = planBody.partial().parse(req.body);
      return mantel.edit(req.hid, req.principal, (h) => Object.assign(find(h.plan, param(req, "id"), "plan item"), body));
    }),
  );

  f.delete(
    "/plan/:id",
    wrap(async (req) =>
      mantel.edit(req.hid, req.principal, (h) => {
        h.plan = h.plan.filter((p) => p.id !== req.params.id);
        return { ok: true };
      }),
    ),
  );

  f.post(
    "/plan/:id/done",
    wrap(async (req) => {
      const done = z.object({ done: z.boolean() }).parse(req.body).done;
      return mantel.edit(req.hid, req.principal, (h, me) => {
        const item = find(h.plan, param(req, "id"), "plan item");
        if (done) {
          item.doneAt = now();
          item.doneBy = me.id;
        } else {
          delete item.doneAt;
          delete item.doneBy;
        }
        return item;
      });
    }),
  );

  f.get("/guidance", wrap(async () => GUIDANCE));

  f.post(
    "/topics",
    wrap(async (req) => {
      const body = topicBody.parse(req.body);
      return mantel.edit(req.hid, req.principal, (h, me) => {
        const at = now();
        const topic: Topic = {
          id: newTopicId(),
          ...body,
          fallback: body.fallback ?? body.answer,
          author: me.id,
          updatedAt: at,
          ...approval(me, at),
        };
        h.topics.push(topic);
        return topic;
      });
    }),
  );

  f.put(
    "/topics/:id",
    wrap(async (req) => {
      const body = topicBody.partial().parse(req.body);
      return mantel.edit(req.hid, req.principal, (h, me) => {
        const t = find(h.topics, param(req, "id"), "topic");
        const wordsChanged = body.answer !== undefined && body.answer !== t.answer;
        Object.assign(t, body, { updatedAt: now() });
        if (wordsChanged) {
          t.author = me.id;
          // A recording of the old words is no longer a recording of this answer.
          if (!body.audio) delete t.audio;
        }
        if (isPrimary(me)) Object.assign(t, approval(me, t.updatedAt));
        else {
          delete t.approvedBy;
          delete t.approvedAt;
        }
        return t;
      });
    }),
  );

  const approveRoute = (collection: "topics" | "moments" | "messages") =>
    wrap(async (req) =>
      mantel.edit(req.hid, req.principal, (h, me) => {
        if (!isPrimary(me)) throw new HttpError(403, "Only the primary caregiver can approve");
        const item = find(h[collection] as { id: string; approvedBy?: string; approvedAt?: string }[], param(req, "id"), collection.slice(0, -1));
        item.approvedBy = me.id;
        item.approvedAt = now();
        return item;
      }),
    );

  const deleteRoute = (collection: "topics" | "moments" | "messages") =>
    wrap(async (req) =>
      mantel.edit(req.hid, req.principal, (h) => {
        (h[collection] as { id: string }[]) = (h[collection] as { id: string }[]).filter((x) => x.id !== req.params.id);
        return { ok: true };
      }),
    );

  f.post("/topics/:id/approve", approveRoute("topics"));
  f.delete("/topics/:id", deleteRoute("topics"));
  f.post("/moments/:id/approve", approveRoute("moments"));
  f.delete("/moments/:id", deleteRoute("moments"));
  f.post("/messages/:id/approve", approveRoute("messages"));
  f.delete("/messages/:id", deleteRoute("messages"));

  f.post(
    "/media",
    express.raw({ type: ["image/*", "audio/*", "video/*"], limit: "25mb" }),
    wrap(async (req) => {
      const type = req.header("content-type") ?? "application/octet-stream";
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, "Send the file as the request body");
      const prefix = type.startsWith("image/") ? "photo" : type.startsWith("video/") ? "video" : "audio";
      return mantel.uploadMedia(req.hid, req.body, type, prefix);
    }),
  );

  f.post(
    "/moments",
    wrap(async (req) => {
      const body = momentBody.parse(req.body);
      return mantel.edit(req.hid, req.principal, (h, me) => {
        const at = now();
        const moment: Moment = {
          id: `m-${Date.now().toString(36)}`,
          photo: body.photo,
          caption: body.caption,
          ...(body.year ? { year: body.year } : {}),
          people: body.people,
          calm: body.calm,
          ...(body.story ? { story: { ...body.story, by: me.id } } : {}),
          uploadedBy: me.id,
          ...approval(me, at),
        };
        h.moments.push(moment);
        return moment;
      });
    }),
  );

  f.post(
    "/messages",
    wrap(async (req) => {
      const body = messageBody.parse(req.body);
      return mantel.edit(req.hid, req.principal, (h, me) => {
        const message: Message = { id: `msg-${Date.now().toString(36)}`, from: me.id, ...body, ...approval(me, now()) };
        h.messages.push(message);
        return message;
      });
    }),
  );

  f.post(
    "/drafts/caption",
    wrap(async (req) => {
      const body = z.object({ people: z.array(z.string()).default([]), place: z.string().optional(), year: z.string().optional(), note: z.string().optional() }).parse(req.body);
      const s = await mantel.state(req.hid);
      return draftCaption(s.household, mantel.deps.model, {
        people: body.people,
        ...(body.place ? { place: body.place } : {}),
        ...(body.year ? { year: body.year } : {}),
        ...(body.note ? { note: body.note } : {}),
      });
    }),
  );

  f.post(
    "/drafts/answer",
    wrap(async (req) => {
      const body = z.object({ text: z.string().min(1).max(300), policy: z.enum(["tell", "redirect", "comfort"]) }).parse(req.body);
      const s = await mantel.state(req.hid);
      return draftAnswer(s.household, mantel.deps.model, body.text, body.policy);
    }),
  );

  f.post(
    "/alerts/:id/ack",
    wrap(async (req) => {
      const { result } = await store.update(req.hid, (s) => {
        const me = mantel.member(s, req.principal);
        const a = find(s.alerts, param(req, "id"), "alert");
        a.acknowledgedAt = now();
        a.acknowledgedBy = me.id;
        return a;
      });
      return result;
    }),
  );

  f.get(
    "/digest/:date",
    wrap(async (req) => {
      const s = await mantel.state(req.hid);
      mantel.member(s, req.principal);
      const date = param(req, "date");
      const today = localParts(mantel.clock.now(), s.household.settings.timezone).date;
      if (date > today) throw new HttpError(400, "That day has not happened yet");
      // Today's digest is always written fresh: the day is not over.
      return date === today || !s.digests[date] ? mantel.makeDigest(req.hid, date) : s.digests[date];
    }),
  );

  f.put(
    "/settings",
    wrap(async (req) => {
      const body = settingsBody.parse(req.body);
      return mantel.edit(req.hid, req.principal, (h, me) => {
        if (!isPrimary(me)) throw new HttpError(403, "Only the primary caregiver can change settings");
        Object.assign(h.settings, body);
        return h.settings;
      });
    }),
  );

  f.post(
    "/unusual",
    wrap(async (req) => {
      const body = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), unusual: z.boolean() }).parse(req.body);
      return mantel.edit(req.hid, req.principal, (h) => {
        h.unusualDays = h.unusualDays.filter((d) => d !== body.date);
        if (body.unusual) h.unusualDays.push(body.date);
        return { unusualDays: h.unusualDays };
      });
    }),
  );

  f.get(
    "/privacy",
    wrap(async (req) => {
      const s = await mantel.state(req.hid);
      mantel.member(s, req.principal);
      const events = await store.events(req.hid, "0000", "9999");
      const byType: Record<string, number> = {};
      for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
      return {
        stored: { events: events.length, byType, oldest: events[0]?.at ?? null },
        leavesTheTv: [
          "presence.start / presence.end: a time, nothing else",
          "question: the words the recogniser heard and which answer was shown",
          "moment.shown, story.played, message.played: which item, and when",
        ],
        neverLeavesTheTv: ["camera frames", "microphone audio", "anything heard that was not a question for Mantel"],
      };
    }),
  );

  f.post(
    "/privacy/erase",
    wrap(async (req) => {
      const s = await mantel.state(req.hid);
      mantel.requirePrimary(s, req.principal);
      return { erased: await store.deleteEvents(req.hid) };
    }),
  );

  f.post("/tv/pair-code", wrap(async (req) => mantel.newPairCode(req.hid, req.principal)));

  app.use("/api/family", f);

  // ------------------------------------------------------------ demo controls
  if (config.demo) {
    if (opts.sim) app.use("/ring-sim", opts.sim.router());
    const d = express.Router();
    const hidOf = async () => (await store.households())[0]!;
    d.get(
      "/clock",
      wrap(async () => ({ now: mantel.clock.now().toISOString(), offsetMs: mantel.clock.offset })),
    );
    d.post(
      "/clock",
      wrap(async (req) => {
        const body = z.object({ at: z.string().optional(), time: z.string().optional(), date: z.string().optional(), reset: z.boolean().optional() }).parse(req.body);
        const hid = await hidOf();
        const h = (await mantel.state(hid)).household;
        if (body.reset) mantel.clock.reset();
        else if (body.at) mantel.clock.setTo(new Date(body.at));
        else if (body.time) {
          const date = body.date ?? localParts(mantel.clock.now(), h.settings.timezone).date;
          mantel.clock.setTo(zonedInstant(date, body.time, h.settings.timezone));
        }
        // Bump the version so every screen re-reads the time now.
        await store.update(hid, () => undefined);
        await mantel.tick(hid);
        return { now: mantel.clock.now().toISOString() };
      }),
    );
    d.post(
      "/ring/press",
      wrap(async (req) => {
        if (!opts.sim) throw new HttpError(400, "No Ring simulator");
        const visitor = z.object({ visitor: z.enum(["sarah", "stranger", "courier", "empty"]).default("stranger") }).parse(req.body).visitor as Visitor;
        return opts.sim.press(visitor, mantel.clock.now().getTime());
      }),
    );
    d.post(
      "/ring/contact",
      wrap(async (req) => {
        if (!opts.sim) throw new HttpError(400, "No Ring simulator");
        const open = z.object({ open: z.boolean() }).parse(req.body).open;
        return opts.sim.contact(open, mantel.clock.now().getTime());
      }),
    );
    d.post(
      "/tick",
      wrap(async () => ({ done: await mantel.tick(await hidOf()) })),
    );
    d.post(
      "/reset",
      wrap(async (req) => {
        const body = z.object({ time: z.string().optional() }).parse(req.body ?? {});
        mantel.clock.reset();
        if (body.time) {
          const tz = "America/New_York";
          mantel.clock.setTo(zonedInstant(localParts(new Date(), tz).date, body.time, tz));
        }
        await seedDemo(mantel);
        return { ok: true, now: mantel.clock.now().toISOString() };
      }),
    );
    app.use("/api/dev", d);
  }

  // ------------------------------------------------------------ web apps
  if (opts.webRoot) {
    for (const [path, dir] of [
      ["/tv", "tv"],
      ["/family", "family"],
    ] as const) {
      const root = join(opts.webRoot, dir);
      if (!existsSync(root)) continue;
      app.use(path, express.static(root, { index: "index.html" }));
      app.get(`${path}/*splat`, (_req, res) => res.sendFile(join(root, "index.html")));
    }
    app.get("/", (_req, res) => res.redirect("/family/"));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", issues: err.issues.slice(0, 5) });
      return;
    }
    mantel.deps.log?.("error", { error: (err as Error).message });
    res.status(500).json({ error: "Something went wrong" });
  });

  return app;
}

