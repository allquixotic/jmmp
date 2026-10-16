// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
/** Bun sometimes supplies stack frames without the Error's message. Keep both. */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const headline = `${error.name || "Error"}${error.message ? `: ${error.message}` : ""}`;
  if (!error.stack) return headline;
  if (!error.message || error.stack.includes(error.message)) return error.stack;
  return `${headline}\n${error.stack}`;
}
