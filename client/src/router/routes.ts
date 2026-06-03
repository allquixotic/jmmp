// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "login",
    component: () => import("src/pages/LoginPage.vue"),
    meta: { auth: false },
  },
  {
    path: "/",
    component: () => import("src/layouts/AppLayout.vue"),
    meta: { auth: true },
    children: [
      {
        path: "",
        name: "home",
        component: () => import("src/pages/IndexPage.vue"),
      },
      {
        path: "browse",
        name: "browse",
        component: () => import("src/pages/BrowsePage.vue"),
      },
      {
        path: "album",
        name: "album",
        component: () => import("src/pages/AlbumPage.vue"),
      },
      {
        path: "library/albums",
        name: "library-albums",
        component: () => import("src/pages/library/AlbumsPage.vue"),
      },
      {
        path: "library/artists",
        name: "library-artists",
        component: () => import("src/pages/library/ArtistsPage.vue"),
      },
      {
        path: "library/songs",
        name: "library-songs",
        component: () => import("src/pages/library/SongsPage.vue"),
      },
      {
        path: "library/recent",
        name: "library-recent",
        component: () => import("src/pages/library/RecentPage.vue"),
      },
      {
        path: "search",
        name: "search",
        component: () => import("src/pages/SearchPage.vue"),
      },
      {
        path: "playlists",
        name: "playlists",
        component: () => import("src/pages/PlaylistsPage.vue"),
      },
      {
        path: "playlists/:id",
        name: "playlist",
        component: () => import("src/pages/PlaylistPage.vue"),
        props: true,
      },
      {
        path: "sources",
        name: "sources",
        component: () => import("src/pages/SourcesPage.vue"),
      },
      {
        path: "settings",
        name: "settings",
        component: () => import("src/pages/SettingsPage.vue"),
      },
      {
        path: "settings/passkeys",
        name: "passkeys",
        component: () => import("src/pages/PasskeysPage.vue"),
      },
    ],
  },
  {
    path: "/:catchAll(.*)*",
    component: () => import("src/pages/NotFoundPage.vue"),
  },
];

export default routes;
