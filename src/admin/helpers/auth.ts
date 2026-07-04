/**
 * src/admin/helpers/auth.ts
 * Authorization helpers for the admin panel.
 */

import type { Env } from "../../types/env";

/** Check if a user ID is the authorized admin. */
export function isAuthorized(env: Env, userId: number | undefined): boolean {
  if (!userId) return false;
  return String(userId) === env.ADMIN_ID;
}

/** Format an unauthorized error message. */
export function unauthorizedMessage(userId: number): string {
  return [
    "⛔ <b>Unauthorized</b>",
    "",
    `Your ID: <code>${userId}</code>`,
    "Only the configured admin can use this bot.",
  ].join("\n");
}
