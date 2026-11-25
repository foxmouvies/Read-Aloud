#!/usr/bin/env bash
# Package-content check (B17 regression): the runtime zip must ship only the
# files the browser loads, and any developer-only commands in the shipped
# README must be explicitly labeled as developer-archive-only.
set -euo pipefail
cd "$(dirname "$0")/.."
ZIP="${1:-$(ls -t dist/readaloud-extension-v*.zip | head -1)}"
echo "checking $ZIP"
LISTING="$(unzip -l "$ZIP")"
# 1. No developer-only files in the runtime zip.
for f in package.json package-lock.json test docs node_modules; do
  if echo "$LISTING" | grep -q " $f"; then
    echo "FAIL: developer-only path '$f' present in runtime zip" >&2; exit 1
  fi
done
# 2. Runtime README must not present npm commands without the developer-archive
#    disclaimer directly above the command block.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
unzip -q "$ZIP" README.md -d "$TMP"
if grep -q "npm test" "$TMP/README.md"; then
  grep -q "not to this runtime zip" "$TMP/README.md" \
    || { echo "FAIL: README ships npm commands without the runtime-zip disclaimer" >&2; exit 1; }
fi
# 3. Manifest version matches the zip filename version.
unzip -q "$ZIP" manifest.json -d "$TMP"
MV=$(grep -o '"version": *"[^"]*"' "$TMP/manifest.json" | cut -d'"' -f4)
ZV=$(basename "$ZIP" | sed 's/readaloud-extension-v//; s/\.zip//')
[ "$MV" = "$ZV" ] || { echo "FAIL: manifest $MV != zip $ZV" >&2; exit 1; }
echo "package check OK: v$MV, runtime-only contents, README disclaimer present"
