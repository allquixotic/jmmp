// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

export function removedSourceTrackIds(
  existingSourceTrackIds: string[],
  scannedSourceTrackIds: string[]
): string[] {
  const seen = new Set(scannedSourceTrackIds);
  return existingSourceTrackIds.filter((id) => !seen.has(id));
}
