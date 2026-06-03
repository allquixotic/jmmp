// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineStore } from "pinia";
import { api } from "src/api";
import type {
  Album,
  AlbumListResponse,
  Artist,
  ArtistListResponse,
  SearchResponse,
  Track,
  TrackListResponse,
} from "@jmmp/shared";

interface State {
  artists: Artist[];
  albums: Record<string, Album[]>; // by artist name
  tracks: Record<string, Track[]>; // by album-id-or-name
  search: SearchResponse | null;
  loading: boolean;
}

export const useCatalogStore = defineStore("catalog", {
  state: (): State => ({
    artists: [],
    albums: {},
    tracks: {},
    search: null,
    loading: false,
  }),
  actions: {
    async loadArtists(): Promise<void> {
      this.loading = true;
      try {
        const resp = await api.get<ArtistListResponse>("/api/catalog/artists");
        this.artists = resp.artists;
      } finally {
        this.loading = false;
      }
    },
    async loadAlbums(artist?: string, sourceId?: number): Promise<Album[]> {
      const params = new URLSearchParams();
      if (artist) params.set("artist", artist);
      if (sourceId) params.set("source", String(sourceId));
      const url = params.toString()
        ? `/api/catalog/albums?${params.toString()}`
        : "/api/catalog/albums";
      const resp = await api.get<AlbumListResponse>(url);
      this.albums[catalogKey(artist, sourceId)] = resp.albums;
      return resp.albums;
    },
    async loadTracks(album: string, artist?: string, sourceId?: number): Promise<Track[]> {
      const params = new URLSearchParams();
      params.set("album", album);
      if (artist) params.set("artist", artist);
      if (sourceId) params.set("source", String(sourceId));
      const resp = await api.get<TrackListResponse>(
        `/api/catalog/tracks?${params.toString()}`
      );
      this.tracks[catalogKey(album, sourceId, artist)] = resp.tracks;
      return resp.tracks;
    },
    async loadTracksByArtist(artist: string, sourceId?: number): Promise<Track[]> {
      const params = new URLSearchParams();
      params.set("artist", artist);
      if (sourceId) params.set("source", String(sourceId));
      const resp = await api.get<TrackListResponse>(
        `/api/catalog/tracks?${params.toString()}`
      );
      this.tracks[catalogKey("artist", sourceId, artist)] = resp.tracks;
      return resp.tracks;
    },
    async runSearch(
      q: string,
      options: { sourceId?: number | "all"; field?: "any" | "title" | "artist" | "album" } = {}
    ): Promise<SearchResponse> {
      const params = new URLSearchParams({ q });
      if (options.sourceId && options.sourceId !== "all") {
        params.set("source", String(options.sourceId));
      }
      if (options.field && options.field !== "any") params.set("field", options.field);
      const resp = await api.get<SearchResponse>(`/api/catalog/search?${params.toString()}`);
      this.search = resp;
      return resp;
    },
  },
});

export function catalogKey(
  primary?: string,
  sourceId?: number,
  secondary?: string
): string {
  return `${sourceId ?? "all"}::${primary ?? ""}::${secondary ?? ""}`;
}
