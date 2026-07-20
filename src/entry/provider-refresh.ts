/**
 * src/entry/provider-refresh.ts
 * v12.0.8 — External Provider Refresh Endpoint (called by cron-job.org).
 *
 * This endpoint replaces the old Cloudflare Cron trigger for Layer 2.
 * It is called every 2 hours by cron-job.org:
 *
 *   GET /internal/provider-refresh?key=<CRON_KEY>
 *
 * Auth: same CRON_KEY as /internal/tick (Bearer token, X-Cron-Key header, or ?key= query).
 *
 * Flow:
 *   1. Validate CRON_KEY
 *   2. Return 200 immediately (non-blocking)
 *   3. [background] Run provider refresh + queue maintenance
 *   4. [background] Return JSON result
 *
 * Why external cron?
 *   - Provider refresh is NOT latency-sensitive (content just needs to be
 *     ready before the next publishing window, not at an exact minute).
 *   - Moving it to external cron reduces Cloudflare Worker wakeups by 12/day.
 *   - Cloudflare Cron is reserved for time-critical operations only:
 *       Layer 1 (every 20 min) — scheduler watcher
 *       Layer 3 (every 24h) — daily maintenance
 */

import type { Env, Container } from "../types/env";
import { cronProvidersHandler } from "./cron-providers";

export interface ProviderRefreshDeps {
  readonly env: Env;
  readonly container: Container;
  readonly ctx: ExecutionContext;
}

/**
 * Handler for GET /internal/provider-refresh
 * Auth: Bearer <CRON_KEY> or X-Cron-Key: <CRON_KEY> or ?key=<CRON_KEY>
 */
export async function providerRefreshHandler(
  request: Request,
  url: URL,
  deps: ProviderRefreshDeps,
): Promise<Response> {
  const { env, container, ctx } = deps;

  // ── 1. Authentication ──
  if (!env.CRON_KEY) {
    return json({ ok: false, error: "CRON_KEY not set" }, 500);
  }
  const authHeader = request.headers.get("Authorization") ?? "";
  const xCronKey = request.headers.get("X-Cron-Key") ?? "";
  const queryKey = url.searchParams.get("key") ?? "";
  const providedKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (xCronKey || queryKey);
  if (providedKey !== env.CRON_KEY) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const startedAt = new Date().toISOString();

  // ── 2. Run provider refresh in background, return 200 immediately ──
  // cron-job.org has a timeout — we return fast and work in ctx.waitUntil().
  ctx.waitUntil(cronProvidersHandler({ env, container, ctx }));

  return json({
    ok: true,
    layer: "provider-refresh",
    message: "Provider refresh started in background",
    time: startedAt,
    source: "cron-job.org",
  });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
