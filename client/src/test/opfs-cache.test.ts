// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, test } from "bun:test";
import { evict, getCachedFile, storeStream } from "../storage/opfs-cache";

class MemoryFileHandle {
  kind = "file" as const;

  constructor(
    readonly name: string,
    private files: Map<string, Uint8Array>
  ) {}

  async getFile(): Promise<File> {
    const data = this.files.get(this.name);
    if (!data) throw new Error("not found");
    return new File([new Uint8Array(data)], this.name);
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const thisFiles = this.files;
    const thisName = this.name;
    const chunks: Uint8Array[] = [];
    return {
      async write(data: Blob | Uint8Array | string) {
        if (data instanceof Blob) {
          chunks.push(new Uint8Array(await data.arrayBuffer()));
        } else if (typeof data === "string") {
          chunks.push(new TextEncoder().encode(data));
        } else {
          chunks.push(data);
        }
      },
      async close() {
        const bytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const out = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.byteLength;
        }
        thisFiles.set(thisName, out);
      },
      async abort() {},
    } as FileSystemWritableFileStream;
  }
}

class MemoryDirectoryHandle {
  kind = "directory" as const;
  name = "audio";
  readonly files = new Map<string, Uint8Array>();

  async getDirectoryHandle(): Promise<FileSystemDirectoryHandle> {
    return this as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(
    name: string,
    opts?: { create?: boolean }
  ): Promise<FileSystemFileHandle> {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new Error("not found");
      this.files.set(name, new Uint8Array());
    }
    return new MemoryFileHandle(name, this.files) as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
  }
}

let root: MemoryDirectoryHandle;

beforeEach(() => {
  root = new MemoryDirectoryHandle();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      storage: {
        getDirectory: async () => root,
      },
    },
  });
});

describe("OPFS audio cache", () => {
  test("does not trust orphaned audio files without completed manifest entries", async () => {
    root.files.set("42", new Uint8Array([1, 2, 3]));

    expect(await getCachedFile(42, 3)).toBeNull();
    expect(root.files.has("42")).toBe(false);
  });

  test("evicts cache entries from older manifest formats", async () => {
    root.files.set("42", new Uint8Array([1, 2, 3]));
    root.files.set(
      "manifest.json",
      new TextEncoder().encode(
        JSON.stringify({
          totalBytes: 3,
          entries: {
            42: { trackId: 42, bytes: 3, pinned: false, lastAccessedAt: 0 },
          },
        })
      )
    );

    expect(await getCachedFile(42, 3)).toBeNull();
    expect(root.files.has("42")).toBe(false);
  });

  test("rejects incomplete cache writes and leaves no playable final file", async () => {
    await expect(
      storeStream(42, streamOf([1, 2, 3]), { expectedBytes: 5 })
    ).rejects.toThrow("cached stream incomplete");

    expect(root.files.has("42")).toBe(false);
    expect(root.files.has("42.part")).toBe(false);
    expect(await getCachedFile(42, 5)).toBeNull();
  });

  test("returns only files that match manifest and expected byte count", async () => {
    await storeStream(42, streamOf([1, 2, 3]), { expectedBytes: 3 });

    const cached = await getCachedFile(42, 3);
    expect(cached?.size).toBe(3);
    expect(await getCachedFile(42, 4)).toBeNull();
  });

  test("evicts completed and partial cache files", async () => {
    root.files.set("42", new Uint8Array([1]));
    root.files.set("42.part", new Uint8Array([2]));

    await evict(42);

    expect(root.files.has("42")).toBe(false);
    expect(root.files.has("42.part")).toBe(false);
  });
});

function streamOf(bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}
