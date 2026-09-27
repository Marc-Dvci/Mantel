/**
 * Local server: the API, the Ring simulator, the built web apps, and the tick.
 *
 *   pnpm server                   demo household on :8790
 *   MANTEL_DEMO=0 pnpm server     no demo seed, no dev endpoints
 */

import { join } from "node:path";
import { createApp } from "./app";
import { buildMantel, FIXTURE_MEDIA, REPO_ROOT } from "./build";
import { loadConfig } from "./config";
import { RingSimulator } from "./ringsim";
import { DEMO_HID, seedDemo } from "./seed";

const config = loadConfig();
const log = (msg: string, extra?: Record<string, unknown>) => console.log(`[mantel] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
const mantel = await buildMantel(config, log);

if (config.demo && !(await mantel.deps.store.get(DEMO_HID))) {
  await seedDemo(mantel);
  log("seeded the demo household");
}

const sim = config.demo ? new RingSimulator(`http://127.0.0.1:${config.port}/ring/webhook`, config.ring.webhookSecret, FIXTURE_MEDIA) : undefined;
const app = createApp(mantel, { webRoot: join(REPO_ROOT, "dist"), ...(sim ? { sim } : {}) });

setInterval(async () => {
  for (const hid of await mantel.deps.store.households()) {
    const done = await mantel.tick(hid).catch((err: Error) => [`tick failed: ${err.message}`]);
    if (done.length) log(`tick ${hid}`, { done });
  }
}, 30_000).unref();

app.listen(config.port, "0.0.0.0", () => {
  log(`listening on ${config.publicUrl}`, {
    demo: config.demo,
    store: config.store,
    drafts: Boolean(mantel.deps.model),
    speech: Boolean(mantel.deps.voice),
  });
});
