/**
 * Copies the built TV interface (dist/tv) into the Android app's assets, where
 * the WebView loads it from https://appassets.androidplatform.net/tv/.
 *
 *   pnpm build:web && pnpm build:android-assets
 */

import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const from = join(root, "dist/tv");
const to = join(root, "android/app/src/main/assets/tv");
if (!existsSync(from)) {
  console.error("dist/tv is missing: run pnpm build:web first");
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`copied ${from} -> ${to}`);
