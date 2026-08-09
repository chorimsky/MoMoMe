#!/usr/bin/env bash
# ============================================================
# Fetch the Wavelength wallet WASM runtime and self-host it under
# app/public/wavewalletdk/<version>/ (the SDK's runtimeBaseUrl points here).
# The runtime is ~40MB and is NOT committed to git — run this once locally and
# in CI/deploy before building the frontend. Idempotent: skips if already present.
#
# Source: Lightning Labs official release (lightninglabs/wavelength).
# Version is pinned to the installed @lightninglabs/wavelength-web manifest.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/../app"

VER="${WAVELENGTH_RUNTIME_VERSION:-v0.1.1}"
DEST="public/wavewalletdk/$VER"
URL="https://github.com/lightninglabs/wavelength/releases/download/$VER/Wavewalletdk.wasm.tar.gz"
MARKER="$DEST/wavewalletdk.wasm"

if [[ -f "$MARKER" ]]; then
  echo "✅ Wavelength runtime $VER already present ($(du -sh "$DEST" | cut -f1))."
  exit 0
fi

echo "→ downloading Wavelength runtime $VER (~40MB)…"
TMP="$(mktemp -t wavewalletdk.XXXXXX).tar.gz"
trap 'rm -f "$TMP"' EXIT
curl -fSL -C - --retry 5 --retry-delay 3 -m 900 "$URL" -o "$TMP"
gzip -t "$TMP" || { echo "❌ download incomplete/corrupt" >&2; exit 1; }

mkdir -p "$DEST"
tar -xzf "$TMP" -C "$DEST"

# Self-host the standalone wallet worker too. The SDK's default `new Worker(new
# URL('../wavewalletdk-worker.js', import.meta.url))` resolves to a pre-bundled-dep
# URL that Vite's dev server serves as HTML (Vite can't emit a worker from inside an
# optimized dep), so Wallet.tsx passes an explicit workerURL pointing here. The file
# ships in the installed package (same pinned version as the runtime archive).
# Locate the worker file wherever pnpm placed it — root node_modules OR app/node_modules,
# which differs by hoisting (esp. on Vercel's clean install). `find` is robust to both.
WORKER_SRC="$(find ../node_modules node_modules -path '*@lightninglabs/wavelength-web/dist/wavewalletdk-worker.js' 2>/dev/null | head -1)"
if [[ -n "$WORKER_SRC" && -f "$WORKER_SRC" ]]; then
  cp "$WORKER_SRC" "$DEST/wavewalletdk-worker.js"
  echo "✅ worker → $DEST/wavewalletdk-worker.js  (from $WORKER_SRC)"
else
  echo "❌ wavewalletdk-worker.js not found under node_modules — run pnpm install first." >&2
  exit 1
fi

echo "✅ Wavelength runtime $VER → $DEST ($(du -sh "$DEST" | cut -f1))"
ls "$DEST"
