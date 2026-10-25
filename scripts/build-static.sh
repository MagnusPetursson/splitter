#!/bin/sh
# Build the static, fully client-side site into ./site (or $1):
#   site/index.html, js/, css/, vendor/, samples/, wasm/splitter.wasm
# Serve that directory from any static host (GitHub Pages, a sub-path is fine).
set -eu
cd "$(dirname "$0")/.."
OUT=${1:-site}
GOROOT_DIR=$(go env GOROOT)
cp "$GOROOT_DIR/lib/wasm/wasm_exec.js" web/js/wasm_exec.js
mkdir -p web/wasm
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o web/wasm/splitter.wasm ./cmd/splitter-wasm
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r web/index.html web/css web/js web/vendor web/samples web/wasm "$OUT"/
touch "$OUT/.nojekyll"
# stamp the build id into the page (cache-busts app.js/app.css and shows in the footer)
BUILD=${SPLITTER_BUILD:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}
sed -i "s/__BUILD__/$BUILD/g" "$OUT/index.html"
echo "built $OUT ($(du -sh "$OUT" | cut -f1)); wasm $(wc -c < web/wasm/splitter.wasm) bytes"
