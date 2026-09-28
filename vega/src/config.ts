/**
 * Where the household server is, and this TV's token.
 *
 * Written by `tools/vega/configure.mjs` before a build:
 *   node tools/vega/configure.mjs --server http://192.168.1.20:8795 --token <tv token>
 * The defaults are a server on the development computer as the Vega Virtual
 * Device sees it from WSL 2 (the WSL gateway), with the demo household's TV token.
 */
export const SERVER = 'http://172.22.176.1:8795';
export const TOKEN = 'demo-tv';
