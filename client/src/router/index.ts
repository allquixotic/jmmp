// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineRouter } from "#q-app";
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from "vue-router";
import { useSessionStore } from "src/stores/session";
import routes from "./routes";

export default defineRouter(function ({ store }) {
  const createHistory = import.meta.env.QUASAR_SERVER
    ? createMemoryHistory
    : import.meta.env.QUASAR_VUE_ROUTER_MODE === "history"
      ? createWebHistory
      : createWebHashHistory;

  const router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history: createHistory(import.meta.env.QUASAR_VUE_ROUTER_BASE),
  });

  router.beforeEach(async (to) => {
    const session = useSessionStore(store);
    if (to.meta.auth === false) return true;
    if (!session.statusLoaded) await session.refreshStatus();
    if (!session.hasFullSession) {
      return { name: "login", query: { next: to.fullPath } };
    }
    if (to.name === "passkeys" && !session.isAdmin) return { name: "home" };
    if (to.name === "sources" && !session.canAddSources) return { name: "home" };
    return true;
  });

  return router;
});
