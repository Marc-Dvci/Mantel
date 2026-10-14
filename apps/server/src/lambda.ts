/**
 * AWS Lambda entry points.
 *
 *   api    behind API Gateway (HTTP API): the same Express app as locally
 *   tick   on an EventBridge schedule every five minutes
 *
 * Secrets come from Secrets Manager at cold start. The Ring snapshot fetch runs
 * after the webhook response locally; in Lambda there is no "after", so it runs
 * before the handler returns. The door card is stored first either way.
 *
 * With the demo on, the dev clock's offset is read from the household record on
 * every invocation, because each Lambda instance has its own memory, and the
 * tick reseeds the demo household once a day so its history stays current.
 */

import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import serverless from "serverless-http";
import { localParts } from "../../../packages/core/src";
import { createApp } from "./app";
import { buildMantel, FIXTURE_MEDIA } from "./build";
import { loadConfig } from "./config";
import { RingSimulator } from "./ringsim";
import { DEMO_HID, seedDemo } from "./seed";
import type { Mantel } from "./service";

const log = (msg: string, extra?: Record<string, unknown>) => console.log(JSON.stringify({ msg, ...extra }));

async function loadSecrets() {
  const sm = new SecretsManagerClient({});
  const read = async (arn: string | undefined) => (arn ? (await sm.send(new GetSecretValueCommand({ SecretId: arn }))).SecretString : undefined);
  const [ring, app] = await Promise.all([read(process.env.MANTEL_RING_SECRET_ARN), read(process.env.MANTEL_APP_SECRET_ARN)]);
  if (ring) process.env.RING_WEBHOOK_SECRET = ring;
  if (app) process.env.MANTEL_SECRET = app;
}

async function start(): Promise<{ mantel: Mantel; handler: ReturnType<typeof serverless> }> {
  await loadSecrets();
  const config = loadConfig();
  const mantel = await buildMantel(config, log);
  if (config.demo && !(await mantel.deps.store.get(DEMO_HID))) await seedDemo(mantel);
  const sim = config.demo ? new RingSimulator(`${config.publicUrl}/ring/webhook`, config.ring.webhookSecret, FIXTURE_MEDIA) : undefined;
  const webRoot = process.env.MANTEL_WEB_ROOT;
  const app = createApp(mantel, { defer: (work) => void pending.push(work().catch(() => undefined)), ...(sim ? { sim } : {}), ...(webRoot ? { webRoot } : {}) });
  // API Gateway carries bodies as text: photos, recordings and fonts must go base64.
  return { mantel, handler: serverless(app, { binary: BINARY }) };
}

const BINARY = ["image/*", "audio/*", "video/*", "font/*", "application/octet-stream", "application/font-woff*"];

let pending: Promise<void>[] = [];
let ready: ReturnType<typeof start> | undefined;

async function syncDemoClock(mantel: Mantel) {
  if (!mantel.deps.config.demo) return;
  const state = await mantel.deps.store.get(DEMO_HID);
  mantel.clock.setOffset(state?.clockOffsetMs ?? 0);
}

/** True when the demo household was seeded on an earlier day in its own time zone. */
async function demoIsStale(mantel: Mantel): Promise<boolean> {
  const state = await mantel.deps.store.get(DEMO_HID);
  if (!state) return true;
  const tz = state.household.settings.timezone;
  const today = localParts(new Date(), tz).date;
  return !state.seededAt || localParts(new Date(state.seededAt), tz).date !== today;
}

export const api = async (event: unknown, context: unknown) => {
  ready ??= start();
  const { mantel, handler } = await ready;
  await syncDemoClock(mantel);
  const out = await handler(event as never, context as never);
  await Promise.all(pending);
  pending = [];
  return out;
};

export const tick = async () => {
  ready ??= start();
  const { mantel } = await ready;
  if (mantel.deps.config.demo && (await demoIsStale(mantel))) {
    mantel.clock.reset();
    await seedDemo(mantel);
    log("demo reseeded");
  }
  await syncDemoClock(mantel);
  const results: Record<string, string[]> = {};
  for (const hid of await mantel.deps.store.households()) results[hid] = await mantel.tick(hid);
  log("tick", results);
  return results;
};
