#!/bin/bash
# Copyright 2026 Sean McNamara
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail
cd "$(dirname "$0")/.."

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

echo "==> Resetting manifest stub for dev mode"
cat > server/src/spa-manifest.ts <<'EOF'
// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

// AUTO-GENERATED stub - replaced by build/codegen-spa-manifest.ts before
// the single-binary compile step. In dev mode it stays empty and the static
// route falls back to on-disk client/dist/pwa.

export const SPA_FILES: Record<string, string> = {};
EOF

echo "Wrote dist/jmmp-linux-amd64"
