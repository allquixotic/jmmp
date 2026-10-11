// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

export type Scheme = "http" | "https";

export function originList(origin: string | string[]): string[] {
  return Array.isArray(origin) ? [...origin] : [origin];
}

/** Select the configured public origin when a reverse proxy terminates HTTPS. */
export function configuredRequestOrigin(request: Request, configured: string | string[]): URL {
  const url = new URL(request.url), browserOrigin = request.headers.get("origin");
  const origin = originList(configured).map(value => new URL(value)).find(value => value.host === url.host && (!browserOrigin || value.origin === browserOrigin));
  if (!origin) throw new Error("Request must use a configured jmmp origin");
  return origin;
}

export function withOrigin(origin: string | string[], next: string): string[] {
  const origins = originList(origin);
  return origins.includes(next) ? origins : [...origins, next];
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function isWildcardHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return normalized === "0.0.0.0" || normalized === "::" || normalized === "";
}

export function shouldBindLocalHttpCompanion(
  scheme: Scheme,
  configuredHost: string,
  effectiveHost: string
): boolean {
  return (
    scheme === "https" &&
    isLoopbackHost(configuredHost) &&
    !isLoopbackHost(effectiveHost) &&
    !isWildcardHost(effectiveHost)
  );
}
