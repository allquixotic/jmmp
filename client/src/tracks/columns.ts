// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import type { TrackColumnKey } from "./sort";
export type TableColumnKey = "reorder" | "number" | "title" | TrackColumnKey;
export const TABLE_COLUMNS: TableColumnKey[] = ["reorder", "number", "title", "artist", "album", "source", "duration", "codec", "quality"];
export const DEFAULT_TABLE_COLUMNS: TableColumnKey[] = TABLE_COLUMNS.filter(column => column !== "codec" && column !== "quality");
export const COLUMN_STORAGE_KEY = "jmmp-track-table-columns-v1";
export interface ColumnPreferences { visible: TableColumnKey[]; widths: Partial<Record<TableColumnKey, number>> }
export function tableColumnLabel(column: TableColumnKey): string {
  if (column === "reorder") return "Move";
  if (column === "number") return "Number";
  if (column === "duration") return "Time";
  return column[0]!.toUpperCase() + column.slice(1);
}
export function isDataColumn(column: TableColumnKey): boolean { return column !== "number" && column !== "reorder"; }
export function minimumColumnWidth(column: TableColumnKey): number {
  return column === "reorder" || column === "number" ? 40 : 64;
}
export function clampColumnWidth(column: TableColumnKey, width: number): number {
  return Math.round(Math.max(minimumColumnWidth(column), Math.min(2000, width)));
}
export function defaultColumnWidth(column: TableColumnKey): number {
  if (column === "reorder" || column === "number") return 44;
  if (column === "title") return 240;
  if (column === "duration") return 80;
  if (column === "codec") return 90;
  if (column === "quality") return 124;
  if (column === "source") return 130;
  return 160;
}
export function restoreColumnPreferences(raw: string | null): ColumnPreferences {
  const defaults = { visible: [...DEFAULT_TABLE_COLUMNS], widths: {} };
  if (!raw) return defaults;
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.visible) || !value.widths || typeof value.widths !== "object") return defaults;
    const visible = TABLE_COLUMNS.filter(column => value.visible.includes(column));
    if (!visible.some(isDataColumn)) return defaults;
    const widths: ColumnPreferences["widths"] = {};
    for (const column of TABLE_COLUMNS) {
      const width = value.widths[column];
      if (typeof width === "number" && Number.isFinite(width)) widths[column] = clampColumnWidth(column, width);
    }
    return { visible, widths };
  } catch { return defaults; }
}
