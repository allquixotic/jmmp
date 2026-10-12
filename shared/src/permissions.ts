// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
export const PASSKEY_ROLES = ["viewer", "player", "dj", "admin"] as const;
export type PasskeyRole = typeof PASSKEY_ROLES[number];
export type Permission = "observe" | "control" | "localPlayback" | "playlistWrite" | "sourceAdd" | "admin";
export function isPasskeyRole(value: unknown): value is PasskeyRole {
  return typeof value === "string" && PASSKEY_ROLES.some(role => role === value);
}
export function passkeyRoleLabel(role: PasskeyRole): string {
  return role === "dj" ? "DJ" : role[0]!.toUpperCase() + role.slice(1);
}
export function can(role: PasskeyRole | null | undefined, permission: Permission): boolean {
  if (!isPasskeyRole(role)) return false;
  if (permission === "observe") return true;
  if (permission === "admin") return role === "admin";
  if (permission === "control") return role !== "viewer";
  return role === "dj" || role === "admin";
}
export function canControlPlayback(role: PasskeyRole | null | undefined, moqEnabled: boolean): boolean {
  return can(role, "control") && (moqEnabled || can(role, "localPlayback"));
}
