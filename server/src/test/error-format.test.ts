// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { errorText } from "@jmmp/shared/error-format";

test("V49 a Bun stack without a message retains both the cause and every frame", () => {
  const error = new Error("Spotify audio download failed (timeout)");
  error.stack = "Error\n    at <anonymous> (/native/audio-worker.js:19131:54)\n    at async play (/native/audio-worker.js:19400:2)";
  expect(errorText(error)).toContain(error.message);
  expect(errorText(error)).toContain(error.stack);
});

test("V49 ordinary stacks remain intact; message changes and stackless errors stay useful", () => {
  const error = new Error("Original cause");
  expect(errorText(error)).toBe(error.stack!);
  error.message += " (helper exit 1; timeout)";
  expect(errorText(error)).toContain(error.message);
  error.stack = undefined;
  expect(errorText(error)).toBe(`Error: ${error.message}`);
  expect(errorText("cause")).toBe("cause");
});
