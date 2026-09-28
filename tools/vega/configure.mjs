// Points the Vega app at a household server before a build.
//
//   node tools/vega/configure.mjs --server http://192.168.1.20:8795 --token <tv token>
//
// Writes vega/src/config.ts and lists the server's host in vega/manifest.toml's
// cleartext allowlist (a household server on the home network is plain http).
// The defaults are a server on the development computer as the Vega Virtual
// Device sees it from WSL2 (the WSL gateway), with the demo household's TV token.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const server = arg("server", "http://172.22.176.1:8795").replace(/\/+$/, "");
const token = arg("token", "demo-tv");

const configPath = join(root, "vega/src/config.ts");
const config = readFileSync(configPath, "utf8")
  .replace(/export const SERVER = '.*';/, `export const SERVER = '${server}';`)
  .replace(/export const TOKEN = '.*';/, `export const TOKEN = '${token}';`);
writeFileSync(configPath, config);

const host = new URL(server).hostname;
const manifestPath = join(root, "vega/manifest.toml");
writeFileSync(manifestPath, readFileSync(manifestPath, "utf8").replace(/allowed-domains = \[.*\]/, `allowed-domains = ["${host}"]`));
console.log(`vega app -> ${server} (token ${token.slice(0, 6)}...), cleartext host ${host}`);
