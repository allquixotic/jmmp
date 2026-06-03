// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineStore } from "pinia";
import { api } from "src/api";
import type {
  CreateSourceRequest,
  CreateSourceResponse,
  ListSourcesResponse,
  SourceInstance,
  UpdateSourceRequest,
} from "@jmmp/shared";

interface State {
  sources: SourceInstance[];
  loaded: boolean;
}

export const useSourcesStore = defineStore("sources", {
  state: (): State => ({ sources: [], loaded: false }),
  actions: {
    async load(): Promise<void> {
      const resp = await api.get<ListSourcesResponse>("/api/sources");
      this.sources = resp.sources;
      this.loaded = true;
    },
    async create(req: CreateSourceRequest): Promise<SourceInstance> {
      const resp = await api.post<CreateSourceResponse>("/api/sources", req);
      this.sources.push(resp.source);
      return resp.source;
    },
    async update(id: number, req: UpdateSourceRequest): Promise<SourceInstance> {
      const resp = await api.patch<{ source: SourceInstance }>(
        `/api/sources/${id}`,
        req
      );
      const i = this.sources.findIndex((s) => s.id === id);
      if (i >= 0) this.sources[i] = resp.source;
      return resp.source;
    },
    async remove(id: number): Promise<void> {
      await api.del(`/api/sources/${id}`);
      this.sources = this.sources.filter((s) => s.id !== id);
    },
    async scan(id: number): Promise<void> {
      await api.post(`/api/scan/${id}`);
    },
  },
});
