// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineBoot } from "#q-app";
import { api } from "src/api";

export default defineBoot(({ app }) => {
  app.config.globalProperties.$api = api;
});

declare module "vue" {
  interface ComponentCustomProperties {
    $api: typeof api;
  }
}
