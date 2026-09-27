/**
 * AWS Lambda entry points.
 *
 *   api    behind API Gateway (HTTP API): the same Express app as locally
 *   tick   on an EventBridge schedule every five minutes
 *
 * The Ring snapshot fetch runs after the webhook response locally; in Lambda
 * there is no "after", so it runs before the handler returns. The card is
 * already stored by then, so the TV has it either way.
 */

import serverless from "serverless-http";
import { createApp } from "./app";
import { buildMantel } from "./build";
import { loadConfig } from "./config";

const config = loadConfig();
const log = (msg: string, extra?: Record<string, unknown>) => console.log(JSON.stringify({ msg, ...extra }));
const mantelPromise = buildMantel(config, log);

let pending: Promise<void>[] = [];
let handlerPromise: Promise<ReturnType<typeof serverless>> | undefined;

async function handlerFor() {
  const mantel = await mantelPromise;
  const app = createApp(mantel, { defer: (work) => void pending.push(work().catch(() => undefined)) });
  return serverless(app);
}

export const api = async (event: unknown, context: unknown) => {
  handlerPromise ??= handlerFor();
  const handler = await handlerPromise;
  const out = await handler(event as never, context as never);
  await Promise.all(pending);
  pending = [];
  return out;
};

export const tick = async () => {
  const mantel = await mantelPromise;
  const results: Record<string, string[]> = {};
  for (const hid of await mantel.deps.store.households()) results[hid] = await mantel.tick(hid);
  log("tick", results);
  return results;
};
