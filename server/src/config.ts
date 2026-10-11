// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const parseYaml = (s: string) => Bun.YAML.parse(s) as unknown;
const stringifyYaml = (v: unknown) => Bun.YAML.stringify(v);

export interface AppConfig {
  listen: { host: string; port: number };
  sessionTtlDays: number;
  jwtSecret: string;
  webauthn: {
    rpId: string;
    rpName: string;
    origin: string | string[];
  };
  /**
   * If true (default), the server tries to detect Tailscale at startup and
   * upgrade to HTTPS using the tailnet's MagicDNS hostname + a cert from
   * `tailscale cert`. Disable to keep the server on plain HTTP /
   * the configured rpId.
   */
  tailscaleAuto: boolean;
  dataDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  publicListener?: { host: string; port: number; origin: string };
  moqUpstream?: { publisherUrlFile: string; protocol: string };
}

export function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "jmmp", "jmmp.yml");
  return join(homedir(), ".config", "jmmp", "jmmp.yml");
}

export function defaultDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "jmmp");
  return join(homedir(), ".local", "share", "jmmp");
}

function randomSecret(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Defaults are tuned for "just run it on this machine":
 *  - bind to localhost
 *  - rpId = localhost (so http://localhost:3000 works with passkeys)
 *  - tailscaleAuto = true, so if Tailscale is up we automatically upgrade
 *    to the MagicDNS hostname + HTTPS and rebind to the tailnet IP.
 */
export function writeDefaultConfig(path: string): AppConfig {
  const cfg: AppConfig = {
    listen: { host: "127.0.0.1", port: 3000 },
    sessionTtlDays: 30,
    jwtSecret: randomSecret(),
    webauthn: {
      rpId: "localhost",
      rpName: "jmmp",
      origin: ["http://localhost:9000", "http://localhost:3000"],
    },
    tailscaleAuto: true,
    dataDir: defaultDataDir(),
    logLevel: "info",
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml(cfg), { mode: 0o600 });
  mkdirSync(cfg.dataDir, { recursive: true });
  return cfg;
}

export function loadConfig(path: string): AppConfig {
  const text = readFileSync(path, "utf8");
  const raw = parseYaml(text) as Partial<AppConfig> | null;
  if (!raw) throw new Error(`empty or invalid config: ${path}`);

  const cfg: AppConfig = {
    listen: {
      host: raw.listen?.host ?? "127.0.0.1",
      port: raw.listen?.port ?? 3000,
    },
    sessionTtlDays: raw.sessionTtlDays ?? 30,
    jwtSecret: must(raw.jwtSecret, "jwtSecret"),
    webauthn: {
      rpId: must(raw.webauthn?.rpId, "webauthn.rpId"),
      rpName: must(raw.webauthn?.rpName, "webauthn.rpName"),
      origin: must(raw.webauthn?.origin, "webauthn.origin"),
    },
    tailscaleAuto: raw.tailscaleAuto ?? true,
    dataDir: resolve(raw.dataDir ?? defaultDataDir()),
    logLevel: raw.logLevel ?? "info",
    ...(raw.publicListener ? { publicListener: raw.publicListener } : {}),
    ...(raw.moqUpstream ? { moqUpstream: raw.moqUpstream } : {}),
  };

  if (cfg.publicListener) {
    const listener = cfg.publicListener, origin = new URL(listener.origin);
    if (!["127.0.0.1", "::1"].includes(listener.host) || !Number.isInteger(listener.port) || listener.port < 1024 || listener.port > 65535 || listener.port === cfg.listen.port || origin.protocol !== "https:" || origin.href !== origin.origin + "/") throw new Error("publicListener requires separate loopback port and HTTPS origin");
  }
  if (cfg.moqUpstream && (typeof cfg.moqUpstream.publisherUrlFile !== "string" || !cfg.moqUpstream.publisherUrlFile || typeof cfg.moqUpstream.protocol !== "string")) throw new Error("moqUpstream requires publisherUrlFile and protocol");

  mkdirSync(cfg.dataDir, { recursive: true });
  return cfg;
}

function must<T>(v: T | undefined | null, name: string): T {
  if (v === undefined || v === null) throw new Error(`missing config: ${name}`);
  return v;
}

export function resolveConfigPath(): string {
  return process.env.JMMP_CONFIG ?? defaultConfigPath();
}

export function ensureConfig(): { path: string; cfg: AppConfig; created: boolean } {
  const path = resolveConfigPath();
  if (!existsSync(path)) {
    const cfg = writeDefaultConfig(path);
    return { path, cfg, created: true };
  }
  return { path, cfg: loadConfig(path), created: false };
}
