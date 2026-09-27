/**
 * Amazon Bedrock and Amazon Polly, where a model helps and cannot decide.
 *
 * Bedrock drafts three kinds of words: a photo caption from the facts a family
 * member typed, a calmer version of an answer a family member wrote, and the
 * evening digest's prose from the day's counts. Every draft passes `checkDraft`
 * (no new names, no new numbers, no death words unless the family used them,
 * no diagnostic words in a digest) and captions and answers then wait for a
 * family member's approval. A draft that fails the check is replaced by the
 * deterministic version, and the family app shows which one it is.
 *
 * Polly voices the answers a family member wrote but did not record, so the TV
 * speaks with one consistent voice rather than whatever engine a device has.
 */

import { createHash } from "node:crypto";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import {
  acceptModelDigest,
  checkDraft,
  numbersIn,
  type Digest,
  type DigestFacts,
  type Household,
  type TruthPolicy,
} from "../../../packages/core/src";
import type { Config } from "./config";

export interface ModelClient {
  complete(system: string, user: string): Promise<string>;
}

/** Bedrock over the API endpoint (chat completions) or the runtime SDK (Converse). */
export async function modelFromConfig(config: Config): Promise<ModelClient | undefined> {
  const b = config.bedrock;
  if (!b) return undefined;
  if (b.endpoint) {
    const { getToken } = await import("@aws/bedrock-token-generator");
    const { fromNodeProviderChain } = await import("@aws-sdk/credential-providers");
    const credentials = fromNodeProviderChain();
    const base = b.endpoint.replace(/\/+$/, "");
    return {
      async complete(system, user) {
        const token = await getToken({ credentials, region: config.region });
        const res = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            model: b.modelId,
            max_tokens: 700,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
        if (!res.ok) throw new Error(`Bedrock endpoint answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
        return stripReasoning(body.choices?.[0]?.message?.content ?? "");
      },
    };
  }
  const sdk = await import("@aws-sdk/client-bedrock-runtime");
  const client = new sdk.BedrockRuntimeClient({ region: config.region });
  return {
    async complete(system, user) {
      const out = await client.send(
        new sdk.ConverseCommand({
          modelId: b.modelId,
          system: [{ text: system }],
          messages: [{ role: "user", content: [{ text: user }] }],
          inferenceConfig: { maxTokens: 700 },
        }),
      );
      return stripReasoning((out.output?.message?.content ?? []).map((c) => ("text" in c ? c.text : "")).join(""));
    },
  };
}

/** Reasoning models may prefix their answer with a thinking block. Keep only the answer. */
export function stripReasoning(text: string): string {
  return text.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export interface Drafted {
  text: string;
  source: "model" | "template";
  problems: string[];
}

export interface CaptionInput {
  people: string[];
  place?: string;
  year?: string;
  note?: string;
}

export function templateCaption(c: CaptionInput): string {
  const who = c.people.length ? `You and ${c.people.join(" and ")}` : "You";
  const where = c.place ? ` at ${c.place}` : "";
  const when = c.year ? `, ${c.year}` : "";
  return `${who}${where}${when}.`;
}

const CAPTION_SYSTEM = `You write one caption for a family photograph that will be shown on a television to a person living with dementia.
Speak to the person as "you". Use only the names, place and year you are given, and nothing else you might guess.
One sentence, at most 16 words, warm and plain, no questions, no exclamation marks. Reply with the caption only.`;

export async function draftCaption(h: Household, model: ModelClient | undefined, c: CaptionInput): Promise<Drafted> {
  const template = templateCaption(c);
  if (!model) return { text: template, source: "template", problems: [] };
  const user = JSON.stringify({ people: c.people, place: c.place ?? null, year: c.year ?? null, note: c.note ?? null });
  let text: string;
  try {
    text = (await model.complete(CAPTION_SYSTEM, user)).replace(/^["']|["']$/g, "").trim();
  } catch (err) {
    return { text: template, source: "template", problems: [`model unavailable: ${(err as Error).message.slice(0, 120)}`] };
  }
  const allowedNames = [...c.people, ...(c.place ? c.place.split(/\s+/) : []), ...(c.note ? (c.note.match(/\b[A-Z][a-z]+\b/g) ?? []) : []), h.person.name];
  const allowedNumbers = [...(c.year ? numbersIn(c.year) : []), ...(c.note ? numbersIn(c.note) : [])];
  const check = checkDraft(text, { allowedNames, allowedNumbers, maxChars: 140, maxSentences: 2 });
  return check.ok ? { text, source: "model", problems: [] } : { text: template, source: "template", problems: check.problems };
}

const POLICY_WORDS: Record<TruthPolicy, string> = {
  tell: "tells the truth gently",
  redirect: "acknowledges the question and gently moves to something comforting",
  comfort: "answers the feeling behind the question",
};

function answerSystem(policy: TruthPolicy): string {
  return `A family member wrote an answer that a television will say to their relative who is living with dementia, whenever the relative asks a particular question.
Rewrite it so it is calm, short and kind: at most two sentences, speaking to the person as "you", plain words. The family chose an answer that ${POLICY_WORDS[policy]}; keep that.
Keep every fact the family wrote. Add nothing: no new names, times, places, promises or facts. Reply with the rewritten answer only.`;
}

export async function draftAnswer(h: Household, model: ModelClient | undefined, text: string, policy: TruthPolicy): Promise<Drafted> {
  const original = text.trim();
  if (!model) return { text: original, source: "template", problems: [] };
  let out: string;
  try {
    out = (await model.complete(answerSystem(policy), original)).replace(/^["']|["']$/g, "").trim();
  } catch (err) {
    return { text: original, source: "template", problems: [`model unavailable: ${(err as Error).message.slice(0, 120)}`] };
  }
  const names = [...(original.match(/\b[A-Z][a-z]+\b/g) ?? []), h.person.name, ...h.members.map((m) => m.name), ...h.person.others.map((o) => o.name)];
  const check = checkDraft(out, {
    allowedNames: names,
    allowedNumbers: numbersIn(original),
    maxChars: 220,
    maxSentences: 2,
    allowDeathWords: /\b(died|dead|passed away|death)\b/i.test(original),
  });
  return check.ok ? { text: out, source: "model", problems: [] } : { text: original, source: "template", problems: check.problems };
}

const DIGEST_SYSTEM = `You write the evening summary a family caregiver reads about their relative's day, from the facts given as JSON.
Plain sentences, at most 6, no headings, no lists. Use only the facts given: never add a number, a name or an interpretation.
Never describe health, never guess causes, never say anything is better or worse. Reply with the summary only.`;

export async function writeDigest(h: Household, model: ModelClient | undefined, facts: DigestFacts): Promise<Digest> {
  if (!model) return acceptModelDigest(h, facts, undefined);
  try {
    return acceptModelDigest(h, facts, await model.complete(DIGEST_SYSTEM, JSON.stringify(facts)));
  } catch {
    return acceptModelDigest(h, facts, undefined);
  }
}

export interface Voice {
  /** Returns MP3 bytes. */
  synthesize(text: string): Promise<Buffer>;
  readonly id: string;
}

export function pollyVoice(config: Config): Voice | undefined {
  if (!config.polly) return undefined;
  const client = new PollyClient({ region: config.region });
  const { voiceId, engine } = config.polly;
  return {
    id: `polly-${engine}-${voiceId}`,
    async synthesize(text) {
      const out = await client.send(new SynthesizeSpeechCommand({ Text: text, OutputFormat: "mp3", VoiceId: voiceId as never, Engine: engine }));
      return Buffer.from(await out.AudioStream!.transformToByteArray());
    },
  };
}

/** Media id for a synthesised line: the same words in the same voice are made once. */
export function speechMediaId(voice: Voice, text: string): string {
  return `tts-${createHash("sha1").update(`${voice.id}|${text}`).digest("hex").slice(0, 16)}`;
}
