// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { staticAssetHeaders } from "../routes/static.ts";

test("V15 mutable PWA entry points revalidate while content-hashed bundles are immutable", () => {
  for (const path of ["index.html", "sw.js", "manifest.json", "icons/favicon.svg", "assets/unversioned.js"]) {
    expect(staticAssetHeaders(path)["Cache-Control"]).toBe("no-cache");
  }
  for (const path of ["assets/index-D4sdMD9x.js", "assets/SourcesPage-BXvtqPc9.js", "assets/index-CuLA6KiS.css"]) {
    expect(staticAssetHeaders(path)["Cache-Control"]).toBe("public, max-age=31536000, immutable");
  }
  expect(staticAssetHeaders("sw.js")["Content-Type"]).toBe("application/javascript");
});
