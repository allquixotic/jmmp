// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineStore } from "pinia";
import { api } from "src/api";
import type { QueueEntry, QueueResponse, Track } from "@jmmp/shared";

interface State {
  entries: QueueEntry[];
  index: number;
  loaded: boolean;
}

export const useQueueStore = defineStore("queue", {
  state: (): State => ({ entries: [], index: -1, loaded: false }),
  actions: {
    async load(): Promise<void> {
      const resp = await api.get<QueueResponse>("/api/queue");
      this.entries = resp.entries;
      this.loaded = true;
    },
    async replace(trackIds: number[]): Promise<void> {
      await api.put("/api/queue", { trackIds });
      await this.load();
    },
    async append(trackIds: number[]): Promise<void> {
      await api.post("/api/queue/append", { trackIds });
      await this.load();
    },
    async playFromTracks(tracks: Track[], startIndex = 0): Promise<Track | null> {
      await this.replace(tracks.map((t) => t.id));
      this.index = startIndex;
      return this.entries[startIndex]?.track ?? null;
    },
    next(): Track | null {
      if (this.index + 1 >= this.entries.length) return null;
      this.index += 1;
      return this.entries[this.index]?.track ?? null;
    },
    prev(): Track | null {
      if (this.index <= 0) return null;
      this.index -= 1;
      return this.entries[this.index]?.track ?? null;
    },
  },
});
