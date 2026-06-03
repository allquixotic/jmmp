// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { CachePolicy } from "@jmmp/shared";

export function shouldCacheAudio(policy: CachePolicy, pinned: boolean): boolean {
  return policy === "all" || (policy === "pin-only" && pinned);
}
