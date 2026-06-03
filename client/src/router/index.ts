// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineRouter } from "#q-app/wrappers";
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from "vue-router";
import { useSessionStore } from "src/stores/session";
import routes from "./routes";

export default defineRouter(function ({ store }) {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === "history"
      ? createWebHistory
      : createWebHashHistory;

  const router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history: createHistory(process.env.VUE_ROUTER_BASE),
  });

  router.beforeEach(async (to) => {
    const session = useSessionStore(store);
    if (!session.statusLoaded) await session.refreshStatus();
    if (to.meta.auth === false) return true;
    if (!session.hasFullSession) {
      return { name: "login", query: { next: to.fullPath } };
    }
    return true;
  });

  return router;
});
