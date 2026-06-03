// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

// Tailscale auto-detection + MagicDNS hostname + TLS cert provisioning.
//
// At server startup we ask the `tailscale` CLI for the local node's
// MagicDNS hostname and Tailscale-assigned IP. If both are available we
// request a TLS cert via `tailscale cert <hostname>`. Tailscale's cert
// provisioning issues real, browser-trusted certificates rooted in Let's
// Encrypt — perfect for WebAuthn since the rpId can be the tailnet hostname
// (a registrable domain) instead of a raw IP literal.
//
// Requires Tailscale HTTPS provisioning to be enabled in the admin panel:
//   https://tailscale.com/kb/1153/enabling-https

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface TailscaleInfo {
  available: boolean;
  cli?: string;
  dnsName?: string; // full MagicDNS hostname (for example, host.tailnet.ts.net)
  hostname?: string; // short hostname (e.g. mbp)
  tailscaleIp?: string;
  reason?: string;
}

const MAC_APP_PATH = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

const SEARCH_PATHS = [
  "tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/bin/tailscale",
  MAC_APP_PATH,
];

interface TailscaleStatusSelf {
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
}

interface TailscaleStatus {
  Self?: TailscaleStatusSelf;
  BackendState?: string;
}

async function runCapture(
  cmd: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { exitCode: proc.exitCode ?? 0, stdout, stderr };
}

async function findCli(): Promise<string | null> {
  for (const candidate of SEARCH_PATHS) {
    try {
      const r = await runCapture(candidate, ["version"]);
      if (r.exitCode === 0) return candidate;
    } catch {
      /* binary missing — try next */
    }
  }
  return null;
}

export async function detectTailscale(): Promise<TailscaleInfo> {
  const cli = await findCli();
  if (!cli) {
    return {
      available: false,
      reason: "tailscale CLI not found in PATH or standard locations",
    };
  }

  let status: TailscaleStatus;
  try {
    const r = await runCapture(cli, ["status", "--json"]);
    if (r.exitCode !== 0) {
      return {
        available: false,
        cli,
        reason: `tailscale status exited ${r.exitCode}: ${r.stderr.trim()}`,
      };
    }
    status = JSON.parse(r.stdout) as TailscaleStatus;
  } catch (err) {
    return {
      available: false,
      cli,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  if (status.BackendState && status.BackendState !== "Running") {
    return {
      available: false,
      cli,
      reason: `tailscale backend state is "${status.BackendState}" (not Running)`,
    };
  }

  const self = status.Self;
  if (!self) {
    return { available: false, cli, reason: "tailscale status returned no Self" };
  }

  const dnsName = (self.DNSName ?? "").replace(/\.$/, "");
  const hostname = self.HostName ?? "";
  const ipv4 = (self.TailscaleIPs ?? []).find((ip) => ip.includes(".") && !ip.includes(":"));

  if (!dnsName) {
    return {
      available: false,
      cli,
      reason: "tailscale Self has no DNSName (MagicDNS may be disabled)",
    };
  }

  return {
    available: true,
    cli,
    dnsName,
    hostname,
    ...(ipv4 ? { tailscaleIp: ipv4 } : {}),
  };
}

export interface TailscaleCertPaths {
  certPath: string;
  keyPath: string;
}

/**
 * Fetch (or refresh) a TLS cert for the local Tailscale node. Returns the
 * paths of the cert + key files. Tailscale's CLI handles renewal — calling
 * this on every startup is cheap when the cert is still valid.
 */
export async function provisionCert(
  info: TailscaleInfo,
  dataDir: string
): Promise<TailscaleCertPaths> {
  if (!info.available || !info.cli || !info.dnsName) {
    throw new Error("Tailscale not available; cannot provision cert");
  }
  const certDir = join(dataDir, "tailscale-certs");
  mkdirSync(certDir, { recursive: true });
  const certPath = join(certDir, `${info.dnsName}.crt`);
  const keyPath = join(certDir, `${info.dnsName}.key`);

  // The CLI talks to tailscaled, which may take a few seconds the first time
  // while contacting the coordination server. We capture stdio (not inherit)
  // because inheriting can interfere with the parent process's TTY on macOS.
  const r = await runCapture(info.cli, [
    "cert",
    "--cert-file",
    certPath,
    "--key-file",
    keyPath,
    info.dnsName,
  ]);
  if (r.exitCode !== 0 && (!existsSync(certPath) || !existsSync(keyPath))) {
    throw new Error(
      `tailscale cert failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim()}\n` +
        `Make sure HTTPS Certificates are enabled for your tailnet:\n` +
        `  https://tailscale.com/kb/1153/enabling-https`
    );
  }
  return { certPath, keyPath };
}
