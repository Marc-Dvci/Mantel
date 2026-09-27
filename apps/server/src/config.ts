/**
 * Server configuration, from the environment.
 *
 * With nothing set, the server runs the demo household on local storage, the
 * built-in Ring simulator and the deterministic text paths: no account, no
 * credentials. Each AWS or Ring integration is switched on by its own variable.
 */

import { resolve } from "node:path";

export interface Config {
  port: number;
  /** Public base URL, used in links sent to the family and to Ring. */
  publicUrl: string;
  dataDir: string;
  /** Serve dev endpoints (clock, simulated presses) and seed the demo household. */
  demo: boolean;
  store: "local" | "dynamodb";
  dynamoTable?: string;
  media: "local" | "s3";
  mediaBucket?: string;
  region: string;
  ring: {
    apiBase: string;
    webhookSecret: string;
    accessToken?: string;
    /** Device ids of outside-door contact sensors, for night alerts. */
    outsideDoors: string[];
  };
  bedrock?: { endpoint?: string; modelId: string };
  polly?: { voiceId: string; engine: "neural" | "standard" | "generative" };
  /** Secret for media links and pairing tokens. */
  secret: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8795);
  const demo = env.MANTEL_DEMO !== "0";
  return {
    port,
    publicUrl: env.MANTEL_PUBLIC_URL ?? `http://localhost:${port}`,
    dataDir: resolve(env.MANTEL_DATA_DIR ?? ".state"),
    demo,
    store: env.MANTEL_STORE === "dynamodb" ? "dynamodb" : "local",
    ...(env.MANTEL_TABLE ? { dynamoTable: env.MANTEL_TABLE } : {}),
    media: env.MANTEL_MEDIA === "s3" ? "s3" : "local",
    ...(env.MANTEL_BUCKET ? { mediaBucket: env.MANTEL_BUCKET } : {}),
    region: env.AWS_REGION ?? "us-east-1",
    ring: {
      // Unset means the built-in simulator, served by this same process.
      apiBase: env.RING_API_BASE_URL ?? `http://localhost:${port}/ring-sim`,
      webhookSecret: env.RING_WEBHOOK_SECRET ?? "mantel-local-webhook-secret",
      ...(env.RING_ACCESS_TOKEN ? { accessToken: env.RING_ACCESS_TOKEN } : {}),
      outsideDoors: (env.RING_OUTSIDE_DOORS ?? "ava1.ring.device.FRONTDOOR").split(",").filter(Boolean),
    },
    ...(env.MANTEL_BEDROCK === "1"
      ? {
          bedrock: {
            ...(env.MANTEL_BEDROCK_ENDPOINT ? { endpoint: env.MANTEL_BEDROCK_ENDPOINT } : {}),
            modelId: env.MANTEL_MODEL_ID ?? "openai.gpt-oss-120b",
          },
        }
      : {}),
    ...(env.MANTEL_POLLY === "1"
      ? { polly: { voiceId: env.MANTEL_POLLY_VOICE ?? "Joanna", engine: (env.MANTEL_POLLY_ENGINE as "neural") ?? "neural" } }
      : {}),
    secret: env.MANTEL_SECRET ?? "mantel-local-secret",
  };
}
