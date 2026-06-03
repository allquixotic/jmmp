// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Playlist } from "@jmmp/shared";

export function sortPlaylists(playlists: Playlist[]): Playlist[] {
  return [...playlists].sort(comparePlaylists);
}

export function comparePlaylists(a: Playlist, b: Playlist): number {
  const aPinned = a.pinnedAt ?? null;
  const bPinned = b.pinnedAt ?? null;
  if (aPinned !== null && bPinned === null) return -1;
  if (aPinned === null && bPinned !== null) return 1;
  if (aPinned !== null && bPinned !== null && aPinned !== bPinned) {
    return bPinned - aPinned;
  }
  const aName = a.name.trim();
  const bName = b.name.trim();
  const aGroup = startsWithAlphaNum(aName) ? 1 : 0;
  const bGroup = startsWithAlphaNum(bName) ? 1 : 0;
  if (aGroup !== bGroup) return aGroup - bGroup;
  return aName.localeCompare(bName, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function startsWithAlphaNum(value: string): boolean {
  return /^[A-Za-z0-9]/.test(value);
}
