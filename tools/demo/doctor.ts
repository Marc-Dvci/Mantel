/**
 * What is actually live here.
 *
 *   pnpm check
 *
 * Each optional integration is exercised with a real call when its variable is
 * set, and reported as it was observed: switched off, reachable and accepted,
 * or refused with the service's own words.
 *
 *   MANTEL_BEDROCK=1 [MANTEL_BEDROCK_ENDPOINT=https://bedrock-mantle.us-east-1.api.aws] [MANTEL_MODEL_ID=...]
 *   MANTEL_POLLY=1
 *   MANTEL_STORE=dynamodb MANTEL_TABLE=...
 *   RING_ACCESS_TOKEN=... [RING_API_BASE_URL=https://api.amazonvision.com]
 */

import { writeFileSync } from "node:fs";
import { demoHousehold } from "../../packages/core/src";
import { loadConfig } from "../../apps/server/src/config";
import { draftAnswer, draftCaption, modelFromConfig, pollyVoice } from "../../apps/server/src/language";

const config = loadConfig();
const lines: string[] = [];
const say = (s: string) => {
  lines.push(s);
  console.log(s);
};

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const out = await fn();
  return [out, Math.round(performance.now() - t)];
}

async function bedrock() {
  if (!config.bedrock) return say("Bedrock        off (set MANTEL_BEDROCK=1)");
  const model = await modelFromConfig(config);
  const now = new Date();
  const h = demoHousehold(now);
  try {
    const [caption, ms1] = await timed(() => draftCaption(h, model, { people: ["Robert"], place: "Cape Cod", year: "1972" }));
    say(`Bedrock        caption (${config.bedrock.modelId}, ${ms1} ms, ${caption.source}): ${caption.text}${caption.problems.length ? `  [${caption.problems.join("; ")}]` : ""}`);
    const [answer, ms2] = await timed(() => draftAnswer(h, model, "tell her robert is out at the hardware store and will be back later, dont say he died", "redirect"));
    say(`Bedrock        answer (${ms2} ms, ${answer.source}): ${answer.text}${answer.problems.length ? `  [${answer.problems.join("; ")}]` : ""}`);
  } catch (err) {
    say(`Bedrock        refused: ${(err as Error).message.slice(0, 300)}`);
  }
}

async function polly() {
  const voice = pollyVoice(config);
  if (!voice) return say("Polly          off (set MANTEL_POLLY=1)");
  try {
    const [mp3, ms] = await timed(() => voice.synthesize("Sarah is coming today at four o'clock."));
    writeFileSync(".state/polly-check.mp3", mp3);
    say(`Polly          ${voice.id}: ${mp3.length} bytes of MP3 in ${ms} ms (.state/polly-check.mp3)`);
  } catch (err) {
    say(`Polly          refused: ${(err as Error).name}: ${(err as Error).message.slice(0, 200)}`);
  }
}

async function dynamo() {
  if (config.store !== "dynamodb") return say("DynamoDB       off (local file store)");
  const { DynamoStore } = await import("../../apps/server/src/dynamo");
  try {
    const store = new DynamoStore(config.dynamoTable ?? "mantel");
    const [ids, ms] = await timed(() => store.households());
    say(`DynamoDB       table ${config.dynamoTable}: ${ids.length} household(s), scan ${ms} ms`);
  } catch (err) {
    say(`DynamoDB       refused: ${(err as Error).name}: ${(err as Error).message.slice(0, 200)}`);
  }
}

async function ring() {
  if (!config.ring.accessToken) return say(`Ring           simulator at ${config.ring.apiBase} (set RING_ACCESS_TOKEN for the live API)`);
  try {
    const res = await fetch(`${config.ring.apiBase}/v1/devices`, { headers: { authorization: `Bearer ${config.ring.accessToken}` } });
    const body = await res.text();
    say(`Ring           GET /v1/devices -> ${res.status}: ${body.slice(0, 200)}`);
  } catch (err) {
    say(`Ring           unreachable: ${(err as Error).message}`);
  }
}

await bedrock();
await polly();
await dynamo();
await ring();
