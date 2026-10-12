<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <a v-if="external" :href="external" target="_blank" rel="noopener noreferrer" class="nav-item">
    <q-icon :name="icon" size="18px" class="nav-item-icon" />
    <span class="nav-item-label">{{ label }}</span>
    <q-icon name="open_in_new" size="14px" />
  </a>
  <router-link v-else
    v-slot="{ isActive, href, navigate }"
    :to="to ?? '/'"
    custom
  >
    <a
      :href="href"
      class="nav-item"
      :class="{ active: isActive }"
      @click="navigate"
    >
      <q-icon :name="icon" size="18px" class="nav-item-icon" />
      <span class="nav-item-label">{{ label }}</span>
      <q-icon
        v-if="trailingIcon"
        :name="trailingIcon"
        size="14px"
        class="nav-item-trailing"
      />
    </a>
  </router-link>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";

defineProps<{
  to?: RouteLocationRaw;
  external?: string;
  icon: string;
  label: string;
  trailingIcon?: string | undefined;
}>();
</script>

<style scoped>
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 1px 8px;
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--am-text-secondary);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease;
}

.nav-item:hover {
  background: var(--am-row-hover);
  color: var(--am-text-primary);
}

.nav-item.active {
  background: rgba(255, 45, 85, 0.14);
  color: #ff6b87;
}

.nav-item.active .nav-item-icon {
  color: #ff6b87;
}

.nav-item-icon {
  flex-shrink: 0;
}

.nav-item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-item-trailing {
  flex-shrink: 0;
  color: #ff6b87;
}
</style>
