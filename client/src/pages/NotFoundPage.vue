<!--
  Copyright 2026 Sean McNamara
  SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div class="not-found-page">
    <div class="text-h4 mono">404</div>
    <q-btn flat :to="{ name: 'home' }" label="Go home" />
  </div>
</template>

<style scoped>
.not-found-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
}
</style>
