#!/usr/bin/env bash
# Build the Vega app, and optionally install and launch it on a Vega device.
# Runs where the Vega SDK runs (Linux or macOS; on Windows, inside WSL2).
#
#   bash tools/vega/build.sh             # build build/x86_64-debug/*.vpkg (and armv7, aarch64)
#   bash tools/vega/build.sh --run       # build, install and launch on the one connected device
#
# The build happens in a copy that keeps the repository's layout (vega/ next to
# packages/core/), because the app imports the shared core from ../packages.
# On WSL this keeps node_modules on the Linux file system, which is much faster.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="${MANTEL_VEGA_BUILD:-$HOME/mantel-build}"
[ -f "$HOME/vega/env" ] && source "$HOME/vega/env"

mkdir -p "$out/vega" "$out/packages/core"
rsync -a --delete --exclude node_modules --exclude build --exclude buildinfo.json --exclude package-lock.json "$repo/vega/" "$out/vega/"
[ -f "$repo/vega/package-lock.json" ] && cp "$repo/vega/package-lock.json" "$out/vega/"
rsync -a --delete "$repo/packages/core/src/" "$out/packages/core/src/"

cd "$out/vega"
[ -d node_modules ] || npm ci
npm run build:debug

if [ "${1:-}" = "--run" ]; then
  vega run-app build/x86_64-debug/manteltv_x86_64.vpkg app.mantel.tv.main
fi
