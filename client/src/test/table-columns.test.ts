// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { COLUMN_STORAGE_KEY, DEFAULT_TABLE_COLUMNS, restoreColumnPreferences } from "../tracks/columns";
import { useTableColumnsStore } from "../stores/table-columns";

test("V30 stored columns validate schema, retain a data column, clamp widths and ignore corrupt data", () => {
  for (const raw of [null, "{", "null", '{"version":2}', '{"version":1,"visible":[],"widths":{}}']) {
    expect(restoreColumnPreferences(raw).visible).toEqual(DEFAULT_TABLE_COLUMNS);
  }
  expect(restoreColumnPreferences(JSON.stringify({ version: 1, visible: ["alien", "artist", "artist", "title"], widths: { title: -1, artist: 9999, source: "bad", alien: 1 } })))
    .toEqual({ visible: ["title", "artist"], widths: { title: 64, artist: 2000 } });
});

test("V30 shared layout persists visibility/width, restores in a fresh app and survives denied storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  try {
    setActivePinia(createPinia());
    const columns = useTableColumnsStore();
    columns.toggle("artist"); columns.resize("title", 333); columns.persist();
    expect(values.has(COLUMN_STORAGE_KEY)).toBe(true);
    setActivePinia(createPinia());
    const restored = useTableColumnsStore();
    expect(restored.visible).not.toContain("artist"); expect(restored.widths.title).toBe(333);
    restored.setVisible(["title"]); restored.toggle("title");
    expect(restored.visible).toEqual(["title"]);
    restored.toggle("artist"); restored.toggle("title");
    expect(restored.visible).toEqual(["artist"]);
    restored.reset(); expect(restored.widths).toEqual({}); expect(restored.visible).toEqual(DEFAULT_TABLE_COLUMNS);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("storage denied"); } });
    setActivePinia(createPinia());
    const unavailable = useTableColumnsStore(); unavailable.toggle("artist"); unavailable.resize("title", 99); unavailable.persist();
    expect(unavailable.widths.title).toBe(99);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
