// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
await Bun.write(join(import.meta.dir, "../server/src/spa-manifest.ts"), `// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

// AUTO-GENERATED stub - replaced by build/codegen-spa-manifest.ts before
// the single-binary compile step. In dev mode it stays empty and the static
// route falls back to on-disk client/dist/pwa.

export const SPA_FILES: Record<string, string> = {};
`);
