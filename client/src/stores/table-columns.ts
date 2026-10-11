// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { defineStore } from "pinia";
import { TABLE_COLUMNS, COLUMN_STORAGE_KEY, DEFAULT_TABLE_COLUMNS, restoreColumnPreferences,
  clampColumnWidth, isDataColumn, type TableColumnKey, type ColumnPreferences } from "src/tracks/columns";

export const useTableColumnsStore = defineStore("table-columns", {
  state: (): ColumnPreferences => {
    try { return restoreColumnPreferences(localStorage.getItem(COLUMN_STORAGE_KEY)); }
    catch { return restoreColumnPreferences(null); }
  },
  actions: {
    persist() {
      try { localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify({ version: 1, visible: this.visible, widths: this.widths })); }
      catch { /* Private browsing and full storage must not prevent table editing. */ }
    },
    canHide(column: TableColumnKey): boolean {
      return !isDataColumn(column) || this.visible.filter(isDataColumn).length > 1;
    },
    setVisible(columns: TableColumnKey[]) {
      const visible = TABLE_COLUMNS.filter(column => columns.includes(column));
      if (!visible.some(isDataColumn)) return;
      this.visible = visible; this.persist();
    },
    toggle(column: TableColumnKey) {
      if (this.visible.includes(column)) {
        if (this.canHide(column)) this.setVisible(this.visible.filter(value => value !== column));
      } else this.setVisible([...this.visible, column]);
    },
    resize(column: TableColumnKey, width: number) {
      if (Number.isFinite(width)) this.widths[column] = clampColumnWidth(column, width);
    },
    reset() { this.visible = [...DEFAULT_TABLE_COLUMNS]; this.widths = {}; this.persist(); },
  },
});
