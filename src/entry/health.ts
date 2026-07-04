/**
 * src/entry/health.ts
 * GET / — health check endpoint. Returns version and liveness.
 *
 * This endpoint is intentionally unauthenticated — it's used by uptime
 * monitors. It only reveals non-sensitive info (version, timestamp, presence
 * of config — never the actual values).
 */

import type { Env } from "../types/env";

export interface HealthResponse {
  readonly ok: boolean;
  readonly name: string;
  readonly version: string;
  readonly phase: string;
  readonly time: string;
  readonly hasBotToken: boolean;
  readonly hasKv: boolean;
  readonly hasAdminId: boolean;
  readonly uptime: string;
}

const VERSION = "1.3.0";
const PHASE = "production-ready";
const START_TIME = Date.now();

export function healthHandler(env: Env): Response {
  const body: HealthResponse = {
    ok: true,
    name: "Fredy",
    version: VERSION,
    phase: PHASE,
    time: new Date().toISOString(),
    hasBotToken: !!env.BOT_TOKEN,
    hasKv: !!env.SETTINGS,
    hasAdminId: !!env.ADMIN_ID,
    uptime: `${Math.floor((Date.now() - START_TIME) / 1000)}s`,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

/** Re-export version for other modules (container, etc.). */
export const FREDY_VERSION = VERSION;
export const FREDY_PHASE = PHASE;
