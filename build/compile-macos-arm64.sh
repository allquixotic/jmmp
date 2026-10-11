#!/bin/bash
# Copyright 2026 Sean McNamara
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail
cd "$(dirname "$0")/.."

cleanup() {
  bun build/reset-native.ts
  bun build/reset-spa.ts
}
trap cleanup EXIT
bun build/native.ts aarch64-apple-darwin

echo "==> Building client SPA"
(cd client && bun run build)

echo "==> Codegen embedded SPA manifest"
bun build/codegen-spa-manifest.ts

echo "==> Compiling server binary for macOS arm64"
mkdir -p dist
bun build --compile \
  --target=bun-darwin-arm64 \
  --outfile dist/jmmp-macos-arm64 \
  server/src/main.ts

echo "Wrote dist/jmmp-macos-arm64"
