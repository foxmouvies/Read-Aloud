#!/bin/sh
# Build a versioned distribution zip of the ReadAloud extension.
# Ships only runtime assets: manifest, shared/, content/, popup/, reader/, icons/, vendor/, README.md.
# Tests, docs, fixtures and tooling stay out of the package.
set -e
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' manifest.json | head -1)
OUT="dist/readaloud-extension-v${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"
zip -r "$OUT" manifest.json shared content popup reader icons vendor README.md \
  -x '*.DS_Store' >/dev/null
echo "Built $OUT"
unzip -l "$OUT"
