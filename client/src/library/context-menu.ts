// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { Track } from "@jmmp/shared";

export interface LibraryInfoRow {
  label: string;
  value?: number | string | null;
}

export interface LibraryMenuContext {
  kind: "Album" | "Artist";
  title: string;
  subtitle?: string;
  icon: string;
  playlistLabel: string;
  infoRows: LibraryInfoRow[];
  loadTracks: () => Promise<Track[]>;
}

export function definedInfoRows(rows: LibraryInfoRow[]): LibraryInfoRow[] {
  return rows.filter((row) => row.value !== null && row.value !== undefined && row.value !== "");
}
