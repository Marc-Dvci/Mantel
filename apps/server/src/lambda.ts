/**
 * AWS Lambda entry points.
 *
 *   api    behind API Gateway (HTTP API): the same Express app as locally
 *   tick   on an EventBridge schedule every five minutes
 *
 * Secrets come from Secrets Manager at cold start. The Ring snapshot fetch runs
 * after the webhook response locally; in Lambda there is no "after", so it runs
 * before the handler returns. The door card is stored first either way.
 */

import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import serverless from "serverless-http";
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
  const app = createApp(mantel, { defer: (work) => void pending.push(work().catch(() => undefined)), ...(sim ? { sim } : {}) });
  return { mantel, handler: serverless(app) };
}

let pending: Promise<void>[] = [];
let ready: ReturnType<typeof start> | undefined;

export const api = async (event: unknown, context: unknown) => {
  ready ??= start();
  const { handler } = await ready;
  const out = await handler(event as never, context as never);
  await Promise.all(pending);
  pending = [];
  return out;
};

export const tick = async () => {
  ready ??= start();
  const { mantel } = await ready;
  const results: Record<string, string[]> = {};
  for (const hid of await mantel.deps.store.households()) results[hid] = await mantel.tick(hid);
  log("tick", results);
  return results;
};
