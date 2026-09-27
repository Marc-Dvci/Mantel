/**
 * Photos, recordings and doorbell snapshots.
 *
 * Media never goes to the TV by a public URL. The TV and the family app fetch
 * `/media/<id>?k=<key>`, where the key is an HMAC of the household id, so a
 * link copied out of one household opens nothing in another.
 */

import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface MediaObject {
  data: Buffer;
  contentType: string;
}

export interface MediaStore {
  put(hid: string, id: string, data: Buffer, contentType: string): Promise<void>;
  get(hid: string, id: string): Promise<MediaObject | undefined>;
}

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

export function extensionFor(contentType: string): string {
  return Object.entries(TYPES).find(([, t]) => t === contentType.split(";")[0])?.[0] ?? ".bin";
}

export function newMediaId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

export function mediaKey(secret: string, hid: string): string {
  return createHmac("sha256", secret).update(`media:${hid}`).digest("hex").slice(0, 24);
}

/** Files under a data directory, with a read-only fixtures directory behind it for the demo. */
export class LocalMedia implements MediaStore {
  constructor(
    private readonly dir: string,
    private readonly fixtures?: string,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  async put(hid: string, id: string, data: Buffer, contentType: string) {
    const d = join(this.dir, hid);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, id), data);
    writeFileSync(join(d, `${id}.type`), contentType);
  }

  async get(hid: string, id: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) return undefined;
    const file = join(this.dir, hid, id);
    if (existsSync(file)) {
      return { data: readFileSync(file), contentType: readFileSync(`${file}.type`, "utf8") };
    }
    if (this.fixtures && existsSync(this.fixtures)) {
      const match = readdirSync(this.fixtures).find((f) => f.slice(0, -extname(f).length) === id);
      if (match) return { data: readFileSync(join(this.fixtures, match)), contentType: TYPES[extname(match).toLowerCase()] ?? "application/octet-stream" };
    }
    return undefined;
  }
}

export class S3Media implements MediaStore {
  constructor(
    private readonly bucket: string,
    private readonly s3: S3Client = new S3Client({}),
    private readonly fallback?: MediaStore,
  ) {}

  async put(hid: string, id: string, data: Buffer, contentType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: `media/${hid}/${id}`, Body: data, ContentType: contentType }));
  }

  async get(hid: string, id: string) {
    try {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: `media/${hid}/${id}` }));
      const bytes = await out.Body!.transformToByteArray();
      return { data: Buffer.from(bytes), contentType: out.ContentType ?? "application/octet-stream" };
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey" && this.fallback) return this.fallback.get(hid, id);
      if ((err as { name?: string }).name === "NoSuchKey") return undefined;
      throw err;
    }
  }
}
