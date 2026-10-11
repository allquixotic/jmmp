// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0

import type { ApiResponse } from "@jmmp/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const isMutation = method !== "GET" && method !== "HEAD";
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers ?? {}),
  };
  if (isMutation) headers["X-jmmp-Client"] = "1";

  const init: RequestInit = {
    method,
    credentials: "include",
    headers,
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  if (opts.body !== undefined) {
    if (opts.body instanceof FormData || opts.body instanceof Blob) {
      init.body = opts.body;
    } else {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
  }

  const resp = await fetch(path, init);
  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await resp.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(`HTTP ${resp.status} (non-JSON response)`, resp.status);
  }
  if (!payload || typeof payload !== "object") {
    throw new ApiError(`HTTP ${resp.status} (invalid envelope)`, resp.status);
  }
  if (!payload.ok) {
    throw new ApiError(payload.error, resp.status, payload.code);
  }
  return payload.data;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "POST", body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  del: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "DELETE" }),
};
