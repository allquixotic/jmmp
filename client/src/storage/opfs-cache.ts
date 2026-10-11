// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

// OPFS-backed source-file cache. LRU by total bytes; pin-exempt.
//
// Layout: under the origin's OPFS root, files live at `audio/<trackId>` and
// metadata in `audio/manifest.json`.

interface ManifestEntry {
  trackId: number;
  bytes: number;
  pinned: boolean;
  lastAccessedAt: number;
  cacheVersion?: number;
}

interface Manifest {
  totalBytes: number;
  entries: Record<string, ManifestEntry>;
}

const MANIFEST_FILE = "manifest.json";
const AUDIO_DIR = "audio";
const PART_SUFFIX = ".part";
const CACHE_VERSION = 2;

async function getDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(AUDIO_DIR, { create: true });
}

async function loadManifest(): Promise<Manifest> {
  const dir = await getDir();
  try {
    const handle = await dir.getFileHandle(MANIFEST_FILE);
    const text = await (await handle.getFile()).text();
    return JSON.parse(text) as Manifest;
  } catch {
    return { totalBytes: 0, entries: {} };
  }
}

async function saveManifest(m: Manifest): Promise<void> {
  const dir = await getDir();
  const handle = await dir.getFileHandle(MANIFEST_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(m));
  await writable.close();
}

export async function getCachedFile(
  trackId: number,
  expectedBytes?: number
): Promise<File | null> {
  try {
    const dir = await getDir();
    const m = await loadManifest();
    const entry = m.entries[String(trackId)];
    if (!entry) {
      await removeAudioFile(dir, String(trackId));
      return null;
    }

    const handle = await dir.getFileHandle(String(trackId));
    const file = await handle.getFile();
    if (
      entry.cacheVersion !== CACHE_VERSION ||
      entry.bytes !== file.size ||
      (typeof expectedBytes === "number" && expectedBytes > 0 && entry.bytes !== expectedBytes)
    ) {
      await evict(trackId);
      return null;
    }

    entry.lastAccessedAt = Math.floor(Date.now() / 1000);
    await saveManifest(m);
    return file;
  } catch {
    return null;
  }
}

export async function getCacheEntry(trackId: number): Promise<ManifestEntry | null> {
  const m = await loadManifest();
  const entry = m.entries[String(trackId)] ?? null;
  return entry?.cacheVersion === CACHE_VERSION ? entry : null;
}

export async function storeStream(
  trackId: number,
  stream: ReadableStream<Uint8Array>,
  opts: { pinned?: boolean; expectedBytes?: number } = {}
): Promise<void> {
  const dir = await getDir();
  const finalName = String(trackId);
  const partName = `${finalName}${PART_SUFFIX}`;
  const handle = await dir.getFileHandle(partName, { create: true });
  const writable = await handle.createWritable();
  const reader = stream.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      await writable.write(new Uint8Array(value));
      bytes += value.byteLength;
    }
    await writable.close();
  } catch (err) {
    await writable.abort();
    await removeAudioFile(dir, partName);
    throw err;
  }
  if (
    typeof opts.expectedBytes === "number" &&
    opts.expectedBytes > 0 &&
    bytes !== opts.expectedBytes
  ) {
    await removeAudioFile(dir, partName);
    throw new Error(`cached stream incomplete: expected ${opts.expectedBytes} bytes, got ${bytes}`);
  }

  const partFile = await (await dir.getFileHandle(partName)).getFile();
  const finalHandle = await dir.getFileHandle(finalName, { create: true });
  const finalWritable = await finalHandle.createWritable();
  await finalWritable.write(partFile);
  await finalWritable.close();
  await removeAudioFile(dir, partName);

  const m = await loadManifest();
  m.entries[String(trackId)] = {
    trackId,
    bytes,
    pinned: !!opts.pinned,
    lastAccessedAt: Math.floor(Date.now() / 1000),
    cacheVersion: CACHE_VERSION,
  };
  m.totalBytes = Object.values(m.entries).reduce((s, e) => s + e.bytes, 0);
  await saveManifest(m);
}

export async function pin(trackId: number, pinned: boolean): Promise<void> {
  const m = await loadManifest();
  const e = m.entries[String(trackId)];
  if (e) {
    e.pinned = pinned;
    await saveManifest(m);
  }
}

export async function evict(trackId: number): Promise<void> {
  const dir = await getDir();
  await removeAudioFile(dir, String(trackId));
  await removeAudioFile(dir, `${trackId}${PART_SUFFIX}`);
  const m = await loadManifest();
  const e = m.entries[String(trackId)];
  if (e) {
    m.totalBytes -= e.bytes;
    delete m.entries[String(trackId)];
    await saveManifest(m);
  }
}

async function removeAudioFile(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<void> {
  try {
    await dir.removeEntry(name);
  } catch {
    /* file missing */
  }
}

export async function evictLruIfOver(capBytes: number): Promise<number> {
  const m = await loadManifest();
  if (m.totalBytes <= capBytes) return 0;
  const candidates = Object.values(m.entries)
    .filter((e) => !e.pinned)
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
  let evicted = 0;
  for (const c of candidates) {
    if (m.totalBytes <= capBytes) break;
    await evict(c.trackId);
    evicted++;
    const fresh = await loadManifest();
    m.totalBytes = fresh.totalBytes;
    m.entries = fresh.entries;
  }
  return evicted;
}

export async function cacheStats(): Promise<{
  totalBytes: number;
  trackCount: number;
  pinnedCount: number;
}> {
  const m = await loadManifest();
  const entries = Object.values(m.entries);
  return {
    totalBytes: m.totalBytes,
    trackCount: entries.length,
    pinnedCount: entries.filter((e) => e.pinned).length,
  };
}
