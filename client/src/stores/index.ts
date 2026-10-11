// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { defineStore as definePiniaStore } from "#q-app";
import { createPinia } from "pinia";

export default definePiniaStore(() => createPinia());
