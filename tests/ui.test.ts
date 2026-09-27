/**
 * The real interfaces in a real browser, against the real server.
 *
 * Builds nothing: it serves dist/ (run `pnpm build:web` first) and skips when
 * the build or a Chromium for Playwright is missing.
 */

import { existsSync, mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { zonedInstant } from "../packages/core/src";
import { createApp } from "../apps/server/src/app";
import { loadConfig } from "../apps/server/src/config";
import { LocalMedia } from "../apps/server/src/media";
import { RingClient } from "../apps/server/src/ring";
import { RingSimulator } from "../apps/server/src/ringsim";
import { seedDemo } from "../apps/server/src/seed";
import { Clock, Mantel } from "../apps/server/src/service";
import { LocalStore } from "../apps/server/src/store";

const dist = resolve(__dirname, "../dist");
const fixtures = resolve(__dirname, "../fixtures/media");
const ready = existsSync(join(dist, "tv/index.html")) && existsSync(join(dist, "family/index.html"));

let browser: Browser | undefined;
let server: Server;
let base = "";
let mantel: Mantel;

async function post(path: string, body: unknown) {
  return (await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
}

describe.skipIf(!ready)("interfaces in a browser", () => {
  beforeAll(async () => {
    try {
      browser = await chromium.launch();
    } catch {
      browser = undefined;
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "mantel-ui-"));
    const ringRef = { base: "" };
    mantel = new Mantel({
      config: loadConfig({ MANTEL_DATA_DIR: dir }),
      store: new LocalStore(),
      media: new LocalMedia(join(dir, "media"), fixtures),
      ring: new RingClient("http://ring.local/ring-sim", async () => undefined, (i, init) => fetch(String(i).replace("http://ring.local", ringRef.base), init)),
      clock: new Clock(),
    });
    const sim = new RingSimulator("", mantel.deps.config.ring.webhookSecret, fixtures);
    const app = createApp(mantel, { webRoot: dist, sim });
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", () => r());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ringRef.base = base;
    (sim as unknown as { webhookUrl: string }).webhookUrl = `${base}/ring/webhook`;
    mantel.clock.setTo(zonedInstant("2026-09-29", "14:05", "America/New_York"));
    await seedDemo(mantel);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it("the TV answers a question in the family's words, and shows the door", async () => {
    if (!browser) return;
    // The morning message has played; a question during a message waits for it to finish.
    await fetch(`${base}/api/tv/events`, {
      method: "POST",
      headers: { authorization: "Bearer demo-tv", "content-type": "application/json" },
      body: JSON.stringify({ events: [{ type: "message.played", data: { id: "msg-morning" } }] }),
    });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${base}/tv/?token=demo-tv&dev=1`);
    await page.getByText("Sarah is coming at 4 o'clock").waitFor();
    await page.fill(".dev input", "Where is Robert?");
    await page.press(".dev input", "Enter");
    await page.getByText("Robert loved this house. Shall we look at your photos from Lake Tahoe?").waitFor();
    await page.getByText("Sarah, on Saturday").waitFor();
    await page.keyboard.press("Escape");
    await post("/api/dev/ring/press", { visitor: "stranger" });
    await page.getByText("You're not expecting anyone.").waitFor({ timeout: 25_000 });
    await page.locator(".door-snapshot img").waitFor({ timeout: 10_000 });
    expect(await page.locator(".door-snapshot img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
    await page.close();
  }, 60_000);

  it("a grandson's answer waits for Sarah, and her approval reaches the TV", async () => {
    if (!browser) return;
    const tom = await browser.newPage({ viewport: { width: 412, height: 915 } });
    await tom.goto(`${base}/family/?token=demo-tom#answers`);
    await tom.getByRole("button", { name: "Write a new answer" }).click();
    await tom.getByPlaceholder("Robert", { exact: true }).fill("The garden");
    await tom.getByPlaceholder("where is robert").fill("who waters the garden");
    await tom.locator("textarea").first().fill("Tom waters the garden on Saturdays.");
    await tom.getByRole("button", { name: "Send to Sarah for approval" }).click();
    await tom.getByText("Waiting for approval").first().waitFor();

    const sarah = await browser.newPage({ viewport: { width: 412, height: 915 } });
    await sarah.goto(`${base}/family/?token=demo-sarah#home`);
    await sarah.getByText("Waiting for your approval").waitFor();
    await sarah.getByText("The garden").first().waitFor();
    const before = await (await fetch(`${base}/api/tv/state`, { headers: { authorization: "Bearer demo-tv" } })).json();
    expect(before.household.topics.some((t: { label: string }) => t.label === "The garden")).toBe(false);
    await sarah.locator(".pending", { hasText: "The garden" }).getByRole("button", { name: "Approve" }).click();
    await sarah.locator(".pending", { hasText: "The garden" }).waitFor({ state: "detached" });
    const after = await (await fetch(`${base}/api/tv/state`, { headers: { authorization: "Bearer demo-tv" } })).json();
    expect(after.household.topics.some((t: { label: string }) => t.label === "The garden")).toBe(true);
    await tom.close();
    await sarah.close();
  }, 60_000);

  it("an unanswered question becomes an answer the TV then gives", async () => {
    if (!browser) return;
    const sarah = await browser.newPage({ viewport: { width: 412, height: 915 } });
    await sarah.goto(`${base}/family/?token=demo-sarah#home`);
    const row = sarah.locator(".row", { hasText: "where are my glasses" });
    await row.getByRole("button", { name: "Add an answer" }).click();
    await sarah.getByText("A new answer").waitFor();
    expect(await sarah.getByPlaceholder("where is robert").first().inputValue()).toBe("where are my glasses");
    await sarah.getByPlaceholder("Robert", { exact: true }).fill("Glasses");
    await sarah.locator("textarea").first().fill("Your glasses are on the table by your chair.");
    await sarah.getByRole("button", { name: "Save" }).click();
    await sarah.getByText("Your glasses are on the table by your chair.").waitFor();

    // Ten minutes later: the doorbell card from the first test has expired.
    await post("/api/dev/clock", { time: "14:20", date: "2026-09-29" });
    const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await tv.goto(`${base}/tv/?token=demo-tv&dev=1`);
    await tv.getByText("Good afternoon, Margaret").waitFor();
    await tv.fill(".dev input", "Where are my glasses?");
    await tv.press(".dev input", "Enter");
    await tv.getByText("Your glasses are on the table by your chair.").waitFor();
    await sarah.close();
    await tv.close();
  }, 60_000);
});

