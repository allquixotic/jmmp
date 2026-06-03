// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineStore } from "pinia";
import { api } from "src/api";
import type { Playlist, PlaylistListResponse, PlaylistWithTracks } from "@jmmp/shared";
import { sortPlaylists } from "src/playlists/sort";

interface State {
  playlists: Playlist[];
  loaded: boolean;
}

export const usePlaylistsStore = defineStore("playlists", {
  state: (): State => ({ playlists: [], loaded: false }),
  actions: {
    async load(): Promise<void> {
      const resp = await api.get<PlaylistListResponse>("/api/playlists");
      this.playlists = sortPlaylists(resp.playlists);
      this.loaded = true;
    },
    async create(name: string): Promise<Playlist> {
      const p = await api.post<Playlist>("/api/playlists", { name });
      this.playlists = sortPlaylists([...this.playlists, p]);
      return p;
    },
    async get(id: number): Promise<PlaylistWithTracks> {
      return api.get<PlaylistWithTracks>(`/api/playlists/${id}`);
    },
    async setTracks(id: number, trackIds: number[]): Promise<void> {
      await api.patch(`/api/playlists/${id}`, { trackIds });
      const p = this.playlists.find((x) => x.id === id);
      if (p) p.trackCount = trackIds.length;
    },
    async append(id: number, trackIds: number[]): Promise<void> {
      await api.post(`/api/playlists/${id}/append`, { trackIds });
      const p = this.playlists.find((x) => x.id === id);
      if (p) p.trackCount += trackIds.length;
    },
    async remove(id: number): Promise<void> {
      await api.del(`/api/playlists/${id}`);
      this.playlists = this.playlists.filter((p) => p.id !== id);
    },
    async rename(id: number, name: string): Promise<void> {
      await api.patch(`/api/playlists/${id}`, { name });
      const p = this.playlists.find((x) => x.id === id);
      if (p) p.name = name;
      this.playlists = sortPlaylists(this.playlists);
    },
    async setPinned(id: number, pinned: boolean): Promise<void> {
      const pinnedAt = pinned ? Math.floor(Date.now() / 1000) : null;
      await api.patch(`/api/playlists/${id}`, { pinnedAt });
      const p = this.playlists.find((x) => x.id === id);
      if (p) p.pinnedAt = pinnedAt;
      this.playlists = sortPlaylists(this.playlists);
    },
    async setStorage(id: number, sourceId: number | null): Promise<void> {
      await api.patch(`/api/playlists/${id}`, { sourceId });
      const fresh = await this.get(id);
      const i = this.playlists.findIndex((p) => p.id === id);
      if (i >= 0) {
        this.playlists[i] = {
          id: fresh.id,
          name: fresh.name,
          createdAt: fresh.createdAt,
          updatedAt: fresh.updatedAt,
          trackCount: fresh.trackCount,
          storage: fresh.storage,
          pinnedAt: fresh.pinnedAt,
        };
        this.playlists = sortPlaylists(this.playlists);
      }
    },
  },
});
