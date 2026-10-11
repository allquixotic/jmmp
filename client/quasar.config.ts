// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "#q-app";

export default defineConfig((ctx) => ({
  boot: ["api", "session"],
  css: ["app.scss"],
  extras: ["material-icons", "material-symbols-rounded"],
  build: {
    target: { browser: ["es2023"], node: "node22" },
    alias: { src: ctx.appPaths.srcDir },
    typescript: { strict: true, vueShim: true },
    vueRouterMode: "history",
  },
  devServer: {
    open: false,
    port: 9000,
    proxy: {
      // Preserve the browser-facing Host so OAuth uses the configured origin.
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
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
  sourceFiles: {
    pwaRegisterServiceWorker: "src-pwa/register-service-worker",
    pwaServiceWorker: "src-pwa/custom-service-worker",
  },
  ssr: { prodPort: 3000, middlewares: [], pwa: false },
  pwa: {
    workboxMode: "GenerateSW",
    injectPWAMetaTags: true,
    swFilename: "sw.js",
    manifestFilename: "manifest.json",
    useCredentialsForManifestTag: false,
    extendPWAGenerateSWOptions(options) {
      options.navigateFallbackDenylist = [
        ...(options.navigateFallbackDenylist ?? []),
        /^\/api\//,
      ];
    },
    extendPWAManifestJson(json) {
      json["name"] = "jmmp";
      json["short_name"] = "jmmp";
      json["display"] = "standalone";
      json["theme_color"] = "#0e1116";
      json["background_color"] = "#0e1116";
    },
  },
}));
