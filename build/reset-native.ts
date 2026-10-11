// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
await Bun.write(join(import.meta.dir, "../server/src/audio/assets.ts"), `// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
// Replaced by build/native.ts for production builds; restored after compilation.
export const helperBase64 = "";
export const workerSource = "";
`);
