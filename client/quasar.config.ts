// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "#q-app/wrappers";

export default defineConfig(() => ({
  boot: ["api", "session"],
  css: ["app.scss"],
  extras: ["material-icons", "material-symbols-rounded"],
  build: {
    target: { browser: ["es2023"], node: "node20" },
    typescript: { strict: true, vueShim: true },
    vueRouterMode: "history",
  },
  devServer: {
    open: false,
    port: 9000,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
  framework: {
    config: {
      brand: { primary: "#5b8cff", dark: "#0e1116" },
      dark: "auto",
    },
    plugins: ["Notify", "Dialog", "LocalStorage", "AppFullscreen"],
  },
  animations: [],
  ssr: { prodPort: 3000, middlewares: [], pwa: false },
  pwa: {
    workboxMode: "GenerateSW",
    injectPwaMetaTags: true,
    swFilename: "sw.js",
    manifestFilename: "manifest.json",
    useCredentialsForManifestTag: false,
    extendGenerateSWOptions(options) {
      options.navigateFallbackDenylist = [
        ...(options.navigateFallbackDenylist ?? []),
        /^\/api\//,
      ];
    },
    extendManifestJson(json: Record<string, unknown>) {
      json["name"] = "jmmp";
      json["short_name"] = "jmmp";
      json["display"] = "standalone";
      json["theme_color"] = "#0e1116";
      json["background_color"] = "#0e1116";
    },
  },
}));
