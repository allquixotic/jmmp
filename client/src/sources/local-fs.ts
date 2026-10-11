// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { codecFromExtension, type Codec, type Track } from "@jmmp/shared";
import { api } from "src/api";

const DB_NAME = "jmmp-local-handles";
const STORE = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(sourceId: number, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, sourceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getHandle(sourceId: number): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(sourceId);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function pickLocalSource(label: string): Promise<{ handle: FileSystemDirectoryHandle; label: string }> {
  if (typeof window.showDirectoryPicker !== "function") {
    throw new Error("This browser doesn't support the File System Access API.");
  }
  const handle = await window.showDirectoryPicker({ id: "jmmp-local", mode: "read" });
  return { handle, label };
}

export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const status = await (handle as unknown as {
    queryPermission(opts: { mode: "read" }): Promise<PermissionState>;
  }).queryPermission({ mode: "read" });
  if (status === "granted") return true;
  const granted = await (handle as unknown as {
    requestPermission(opts: { mode: "read" }): Promise<PermissionState>;
  }).requestPermission({ mode: "read" });
  return granted === "granted";
}

export async function bindHandleToSource(
  sourceId: number,
  handle: FileSystemDirectoryHandle
): Promise<void> {
  await saveHandle(sourceId, handle);
}

export interface ScanResult {
  uploaded: number;
  removed: number;
}

export interface FileRow {
  path: string;
  name: string;
  size: number;
  mtime: number;
  codec: Codec;
}

type DirectoryIterationEntry = FileSystemHandle | [string, FileSystemHandle];

export function fileSystemHandleFromDirectoryEntry(
  entry: DirectoryIterationEntry
): FileSystemHandle {
  return Array.isArray(entry) ? entry[1] : entry;
}

function directoryEntries(
  handle: FileSystemDirectoryHandle
): AsyncIterable<DirectoryIterationEntry> {
  const h = handle as unknown as {
    values?: () => AsyncIterable<FileSystemHandle>;
    entries?: () => AsyncIterable<[string, FileSystemHandle]>;
    [Symbol.asyncIterator]?: () => AsyncIterator<DirectoryIterationEntry>;
  };
  if (typeof h.values === "function") return h.values();
  if (typeof h.entries === "function") return h.entries();
  return h as AsyncIterable<DirectoryIterationEntry>;
}

export async function* walkLocalFiles(
  handle: FileSystemDirectoryHandle,
  prefix: string
): AsyncGenerator<FileRow> {
  for await (const entry of directoryEntries(handle)) {
    const e = fileSystemHandleFromDirectoryEntry(entry) as
      | FileSystemDirectoryHandle
      | FileSystemFileHandle;
    if (
      !e ||
      typeof e.name !== "string" ||
      (e.kind !== "directory" && e.kind !== "file")
    ) {
      continue;
    }
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.kind === "directory") {
      yield* walkLocalFiles(e as FileSystemDirectoryHandle, path);
    } else {
      const codec = codecFromExtension(e.name);
      if (!codec) continue;
      const file = await (e as FileSystemFileHandle).getFile();
      yield {
        path,
        name: e.name,
        size: file.size,
        mtime: Math.floor(file.lastModified / 1000),
        codec,
      };
    }
  }
}

export async function scanLocalSource(sourceId: number): Promise<ScanResult> {
  const handle = await getHandle(sourceId);
  if (!handle) throw new Error("No directory handle stored for this source.");
  if (!(await ensurePermission(handle))) {
    throw new Error("Permission to read the directory was denied.");
  }
  let uploaded = 0;
  for await (const f of walkLocalFiles(handle, "")) {
    const file = await openLocalFile(sourceId, f.path);
    if (!file) throw new Error(`Could not read ${f.path}`);
    await uploadLocalFile(sourceId, file, f.path); uploaded++;
  }
  return { uploaded, removed: 0 };

}

export async function openLocalFile(
  sourceId: number,
  relativePath: string
): Promise<File | null> {
  const handle = await getHandle(sourceId);
  if (!handle) return null;
  if (!(await ensurePermission(handle))) return null;
  const parts = relativePath.split("/").filter(Boolean);
  let dir: FileSystemDirectoryHandle = handle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!);
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1]!);
  return await fileHandle.getFile();
}

/** Import bytes permanently; folder handles are only an import convenience. */
export async function uploadLocalFile(sourceId: number, file: File, path = file.name): Promise<void> {
  if (!codecFromExtension(path)) return;
  const uploaded = await api.post<{ track: Omit<Track, "id"> }>(`/api/sources/${sourceId}/upload?path=${encodeURIComponent(path)}`, file);
  await api.post("/api/catalog/upload", { sourceId, tracks: [uploaded.track] });
}
