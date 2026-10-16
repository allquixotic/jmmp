// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
import { errorText } from "@jmmp/shared/error-format";
export class UnavailableTrackError extends Error {
  constructor(message: string, serverStack?: string) {
    super(message);
    this.name = "UnavailableTrackError";
    if (serverStack) this.stack = serverStack;
  }
}
export interface UnavailableTrackEvent { trackId: number; error: string }
export function playbackErrorText(error: unknown): string {
  return errorText(error);
}
