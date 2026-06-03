// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = ORDER.info;

export function setLogLevel(level: Level): void {
  threshold = ORDER[level];
}

function emit(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const line = extra
    ? `${new Date().toISOString()} [${level}] ${msg} ${JSON.stringify(extra)}`
    : `${new Date().toISOString()} [${level}] ${msg}`;
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit("error", msg, extra),
};
