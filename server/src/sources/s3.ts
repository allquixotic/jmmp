// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { ByteRange, ScanEvent, SourceConfig, SourceSecrets } from "@jmmp/shared";
import { codecFromExtension } from "@jmmp/shared";
import { signRequest } from "./s3-sign.ts";
import type { ScanContext, ServerSourceAdapter, UpstreamFetchResult } from "./types.ts";

export interface S3Config {
  kind: "s3";
  endpoint: string;
  region: string;
  bucket: string;
  prefix?: string;
  pathStyle?: boolean;
}

export interface S3Secrets {
  kind: "s3";
  accessKeyId: string;
  secretAccessKey: string;
}

function buildUrl(config: S3Config, key?: string, query?: Record<string, string>): URL {
  const base = new URL(config.endpoint);
  if (config.pathStyle) {
    base.pathname = `/${config.bucket}${key ? "/" + key : ""}`;
  } else {
    base.host = `${config.bucket}.${base.host}`;
    base.pathname = key ? `/${key}` : "/";
  }
  if (query) {
    for (const [k, v] of Object.entries(query)) base.searchParams.set(k, v);
  }
  return base;
}

export function makeS3Adapter(
  config: SourceConfig,
  secrets: SourceSecrets
): ServerSourceAdapter {
  if (config.kind !== "s3" || secrets.kind !== "s3") {
    throw new Error("not an s3 source");
  }
  const s3Config = config as S3Config;
  const s3Secrets = secrets as S3Secrets;

  async function listObjects(
    continuationToken?: string
  ): Promise<{ keys: Array<{ key: string; size: number; etag: string; mtime: number }>; nextToken?: string }> {
    const query: Record<string, string> = { "list-type": "2", "max-keys": "1000" };
    if (s3Config.prefix) query["prefix"] = s3Config.prefix;
    if (continuationToken) query["continuation-token"] = continuationToken;
    const url = buildUrl(s3Config, undefined, query);
    const headers = await signRequest({
      method: "GET",
      url,
      region: s3Config.region,
      accessKeyId: s3Secrets.accessKeyId,
      secretAccessKey: s3Secrets.secretAccessKey,
    });
    const resp = await fetch(url.toString(), { method: "GET", headers });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`S3 list failed (${resp.status}): ${text.slice(0, 200)}`);
    }
    const xml = await resp.text();
    return parseListXml(xml);
  }

  return {
    async *scan(ctx: ScanContext): AsyncIterable<ScanEvent> {
      let token: string | undefined;
      let count = 0;
      do {
        if (ctx.signal?.aborted) return;
        const page = await listObjects(token);
        for (const obj of page.keys) {
          const codec = codecFromExtension(obj.key);
          if (!codec) continue;
          yield {
            kind: "add",
            track: {
              sourceId: 0,
              sourceTrackId: obj.key,
              title: filename(obj.key),
              artist: "",
              album: "",
              durationMs: 0,
              codec,
              fileSize: obj.size,
              mtime: obj.mtime,
              etag: obj.etag,
            } as never,
          };
          count++;
          if (count % 200 === 0) ctx.onProgress?.(count);
        }
        token = page.nextToken;
      } while (token);
      ctx.onProgress?.(count);
    },

    async fetch(sourceTrackId: string, range?: ByteRange): Promise<UpstreamFetchResult> {
      const url = buildUrl(s3Config, sourceTrackId);
      const reqHeaders: Record<string, string> = {};
      if (range) {
        reqHeaders["range"] =
          range.end !== undefined
            ? `bytes=${range.start}-${range.end}`
            : `bytes=${range.start}-`;
      }
      const headers = await signRequest({
        method: "GET",
        url,
        region: s3Config.region,
        accessKeyId: s3Secrets.accessKeyId,
        secretAccessKey: s3Secrets.secretAccessKey,
        headers: reqHeaders,
      });
      const resp = await fetch(url.toString(), { method: "GET", headers });
      if (!resp.body) throw new Error("S3 fetch returned no body");
      return { body: resp.body, status: resp.status, headers: resp.headers };
    },
  };
}

function filename(key: string): string {
  const slash = key.lastIndexOf("/");
  const base = slash >= 0 ? key.slice(slash + 1) : key;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

interface ParsedList {
  keys: Array<{ key: string; size: number; etag: string; mtime: number }>;
  nextToken?: string;
}

export function parseListXml(xml: string): ParsedList {
  const keys: ParsedList["keys"] = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match: RegExpExecArray | null;
  while ((match = contentsRegex.exec(xml))) {
    const body = match[1]!;
    const key = takeTag(body, "Key");
    const size = parseInt(takeTag(body, "Size") || "0", 10);
    const etag = takeTag(body, "ETag").replace(/^"|"$/g, "");
    const lastModified = takeTag(body, "LastModified");
    const mtime = lastModified ? Math.floor(new Date(lastModified).getTime() / 1000) : 0;
    if (key) keys.push({ key, size, etag, mtime });
  }
  let nextToken: string | undefined;
  const isTruncated = takeTag(xml, "IsTruncated") === "true";
  if (isTruncated) {
    const next = takeTag(xml, "NextContinuationToken");
    if (next) nextToken = next;
  }
  return { keys, nextToken };
}

function takeTag(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? decodeXmlEntities(m[1]!) : "";
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => {
      switch (entity) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        default:
          return entity;
      }
    })
    .replace(/&#(\d+);/g, (entity, n) =>
      decodeCodePoint(Number(n), entity)
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (entity, n) =>
      decodeCodePoint(parseInt(n, 16), entity)
    );
}

function decodeCodePoint(n: number, fallback: string): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return fallback;
  return String.fromCodePoint(n);
}
