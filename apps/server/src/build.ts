/**
 * Builds a Mantel service from configuration: the one place that chooses
 * between local and AWS implementations.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config";
import { DynamoStore } from "./dynamo";
import { modelFromConfig, pollyVoice } from "./language";
import { LocalMedia, S3Media } from "./media";
import { RingClient } from "./ring";
import { Clock, Mantel } from "./service";
import { LocalStore, type Store } from "./store";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The bearer token: from the file when one is named (re-read each call), else the environment. */
export function ringToken(config: Config): () => Promise<string | undefined> {
  return async () => {
    if (config.ring.tokenFile) return (await readFile(config.ring.tokenFile, "utf8")).trim() || undefined;
    return config.ring.accessToken;
  };
}
export const REPO_ROOT = resolve(HERE, "../../..");
export const FIXTURE_MEDIA = process.env.MANTEL_FIXTURES ?? join(REPO_ROOT, "fixtures/media");

export async function buildMantel(config: Config, log?: (msg: string, extra?: Record<string, unknown>) => void): Promise<Mantel> {
  const store: Store =
    config.store === "dynamodb" ? new DynamoStore(config.dynamoTable ?? "mantel") : new LocalStore(join(config.dataDir, "store"));
  const local = new LocalMedia(join(config.dataDir, "media"), FIXTURE_MEDIA);
  const media = config.media === "s3" ? new S3Media(config.mediaBucket ?? "mantel-media", undefined, local) : local;
  const ring = new RingClient(config.ring.apiBase, ringToken(config));
  return new Mantel({
    config,
    store,
    media,
    ring,
    clock: new Clock(),
    model: await modelFromConfig(config),
    voice: pollyVoice(config),
    ...(log ? { log } : {}),
  });
}
