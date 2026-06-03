// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

// IndexedDB blob cache for album art keyed by sha256 hash.

const DB_NAME = "jmmp-art";
const STORE = "art";

async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getArt(hash: string): Promise<Blob | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(hash);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putArt(hash: string, blob: Blob): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, hash);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const objectUrlCache = new Map<string, string>();

export function isRemoteArtReference(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("/api/art/");
}

export async function artUrl(hash: string): Promise<string | null> {
  if (isRemoteArtReference(hash)) return hash;
  const cached = objectUrlCache.get(hash);
  if (cached) return cached;
  const blob = await getArt(hash);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(hash, url);
  return url;
}
