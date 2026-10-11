<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <q-page>
    <PageHero title="Sources" subtitle="Server uploads, S3 buckets, and Qobuz.">
      <template v-slot:actions>
        <q-btn-dropdown unelevated color="primary" icon="add" label="Add source">
          <q-list>
            <q-item clickable v-close-popup @click="importSourceId = undefined; showLocal = true">
              <q-item-section avatar><q-icon name="folder" /></q-item-section>
              <q-item-section>Upload music</q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="showS3 = true">
              <q-item-section avatar><q-icon name="cloud" /></q-item-section>
              <q-item-section>S3 bucket</q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="showQobuz = true">
              <q-item-section avatar><q-icon name="library_music" /></q-item-section>
              <q-item-section>Qobuz</q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
      </template>
    </PageHero>

    <q-banner v-if="error" class="bg-red-1 text-red-10 q-ma-md" dense rounded>
      {{ error }}
    </q-banner>

    <div v-if="sources.sources.length === 0" class="sources-empty">
      No sources yet. Add one to get started.
    </div>

    <div v-else class="sources-list">
      <div v-for="s in sources.sources" :key="s.id" class="source-card">
        <div class="source-icon" :class="`source-icon-${s.kind}`">
          <q-icon :name="iconFor(s.kind)" size="24px" />
        </div>
        <div class="source-text">
          <div class="source-name">{{ s.name }}</div>
          <div class="source-meta">
            {{ s.kind }} · cache: {{ s.cachePolicy }} ·
            <span v-if="s.lastScannedAt"> scanned {{ formatTs(s.lastScannedAt) }}</span>
            <span v-else>never scanned</span>
          </div>
        </div>
        <div class="source-actions">
          <q-btn flat dense icon="refresh" @click="rescan(s.id, s.kind)">
            <q-tooltip>{{ s.kind === "local" ? "Import more music" : "Rescan" }}</q-tooltip>
          </q-btn>
          <q-btn flat dense icon="delete" color="negative" @click="remove(s.id)">
            <q-tooltip>Remove</q-tooltip>
          </q-btn>
        </div>
      </div>
    </div>

    <AddLocalDialog :source-id="importSourceId" v-model="showLocal" @added="afterAdd" />
    <AddS3Dialog v-model="showS3" @added="afterAdd" />
    <AddQobuzDialog v-model="showQobuz" @added="afterAdd" />
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useSourcesStore } from "src/stores/sources";
import AddLocalDialog from "src/components/AddLocalDialog.vue";
import AddS3Dialog from "src/components/AddS3Dialog.vue";
import AddQobuzDialog from "src/components/AddQobuzDialog.vue";
import PageHero from "src/components/PageHero.vue";

const sources = useSourcesStore();
const error = ref<string | null>(null);
const showLocal = ref(false);
const importSourceId = ref<number>();
const showS3 = ref(false);
const showQobuz = ref(false);

onMounted(async () => {
  try {
    await sources.load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

function iconFor(kind: string): string {
  if (kind === "local") return "folder";
  if (kind === "s3") return "cloud";
  if (kind === "qobuz") return "library_music";
  return "storage";
}

function formatTs(s: number): string {
  return new Date(s * 1000).toLocaleString();
}

async function rescan(id: number, kind: string): Promise<void> {
  error.value = null;
  try {
    if (kind === "local") {
      importSourceId.value = id; showLocal.value = true; return;
    } else {
      await sources.scan(id);
    }
    await sources.load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function remove(id: number): Promise<void> {
  if (!window.confirm("Remove this source and all its catalog entries?")) return;
  await sources.remove(id);
}

async function afterAdd(): Promise<void> {
  await sources.load();
}
</script>

<style scoped>
.sources-list {
  padding: 16px 32px 32px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.source-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: var(--am-card-bg);
  border: 1px solid var(--am-card-border);
  border-radius: 10px;
}

.source-icon {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.source-icon-local {
  background: linear-gradient(135deg, #4a5cff, #2030c0);
}

.source-icon-s3 {
  background: linear-gradient(135deg, #ff9533, #cc6600);
}

.source-icon-qobuz {
  background: linear-gradient(135deg, #5a4cff, #2d1fa8);
}

.source-text {
  flex: 1;
}

.source-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--am-text-primary);
}

.source-meta {
  font-size: 12px;
  color: var(--am-text-secondary);
}

.source-actions {
  display: flex;
  gap: 4px;
}

.sources-empty {
  padding: 48px;
  text-align: center;
  color: var(--am-text-muted);
}
</style>
