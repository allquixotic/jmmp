// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";

import {
  fileSystemHandleFromDirectoryEntry,
  walkLocalFiles,
} from "../sources/local-fs";

function fileHandle(name: string, size = 123): FileSystemFileHandle {
  return {
    kind: "file",
    name,
    async getFile() {
      return new File([new Uint8Array(size)], name, { lastModified: 1_700_000_000_000 });
    },
  } as FileSystemFileHandle;
}

function directoryHandle(
  name: string,
  entries: Array<[string, FileSystemHandle]>
): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    name,
    async *[Symbol.asyncIterator]() {
      yield* entries;
    },
  } as FileSystemDirectoryHandle;
}

describe("local filesystem source scanning", () => {
  test("normalizes Chromium directory iterator tuples to handles", () => {
    const handle = fileHandle("song.mp3");

    expect(fileSystemHandleFromDirectoryEntry(["song.mp3", handle])).toBe(handle);
    expect(fileSystemHandleFromDirectoryEntry(handle)).toBe(handle);
  });

  test("walks Chromium tuple-style directory entries without undefined file names", async () => {
    const root = directoryHandle("Music", [
      ["song.mp3", fileHandle("song.mp3")],
      ["cover.jpg", fileHandle("cover.jpg")],
      [
        "Album",
        directoryHandle("Album", [["nested.flac", fileHandle("nested.flac", 456)]]),
      ],
    ]);

    const rows = [];
    for await (const row of walkLocalFiles(root, "")) rows.push(row);

    expect(rows).toEqual([
      {
        path: "song.mp3",
        name: "song.mp3",
        size: 123,
        mtime: 1_700_000_000,
        codec: "mp3",
      },
      {
        path: "Album/nested.flac",
        name: "nested.flac",
        size: 456,
        mtime: 1_700_000_000,
        codec: "flac",
      },
    ]);
  });
});
