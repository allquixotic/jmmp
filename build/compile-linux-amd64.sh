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
bun build/native.ts x86_64-unknown-linux-gnu

echo "==> Building client SPA"
(cd client && bun run build)

echo "==> Codegen embedded SPA manifest"
bun build/codegen-spa-manifest.ts

echo "==> Compiling server binary for Linux amd64"
mkdir -p dist
bun build --compile \
  --target=bun-linux-x64 \
  --outfile dist/jmmp-linux-amd64 \
  server/src/main.ts

echo "Wrote dist/jmmp-linux-amd64"
