/**
 * `pnpm ring:spike`: read a Ring account once and print what it returned.
 *
 *   RING_ACCESS_TOKEN=<token from the Ring Developer Playground> pnpm ring:spike
 *
 * The account, every device with the kind Mantel reads from it, and each
 * camera's last seven days of event history as Mantel parses it. The raw
 * responses are written to `.state/ring-spike.json`, so a difference between
 * Ring's answer and Mantel's reading of it is visible on the first run.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RingClient } from "../../apps/server/src/ring";

const apiBase = process.env.RING_API_BASE_URL ?? "https://api.amazonvision.com";
const tokenFile = process.env.RING_ACCESS_TOKEN_FILE;
const token = async () => (tokenFile ? (await readFile(tokenFile, "utf8")).trim() : process.env.RING_ACCESS_TOKEN);

async function main() {
  if (!(await token())) throw new Error("set RING_ACCESS_TOKEN (or RING_ACCESS_TOKEN_FILE) to a token from the Ring Developer Playground");
  const ring = new RingClient(apiBase, token);
  const out: Record<string, unknown> = { apiBase, at: new Date().toISOString() };

  const me = await ring.me().catch((err: Error) => ({ error: err.message }));
  out.me = me;
  console.log(`\nRing account at ${apiBase}`);
  console.log(`  user        ${JSON.stringify(me).slice(0, 160)}`);

  const { devices, raw } = await ring.devices();
  out.devices = raw;
  console.log(`  devices     ${devices.length}`);
  for (const d of devices) console.log(`    ${d.kind.padEnd(9)} ${d.name}  ${d.id}`);

  const since = Date.now() - 7 * 86_400_000;
  const history: Record<string, unknown> = {};
  for (const d of devices.filter((x) => x.kind !== "other")) {
    try {
      const h = await ring.history(d.id, since);
      history[d.id] = h.raw;
      const counts = h.events.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.eventType]: (acc[e.eventType] ?? 0) + 1 }), {});
      console.log(`  history     ${d.name}: ${h.events.length} events ${JSON.stringify(counts)}`);
      const last = h.events.at(-1);
      if (last) console.log(`              latest ${last.eventType} at ${new Date(last.timestamp).toISOString()}`);
    } catch (err) {
      history[d.id] = { error: (err as Error).message };
      console.log(`  history     ${d.name}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  out.history = history;

  const file = resolve(".state/ring-spike.json");
  await mkdir(resolve(".state"), { recursive: true });
  await writeFile(file, JSON.stringify(out, null, 2));
  console.log(`\n  raw responses: ${file}\n`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
