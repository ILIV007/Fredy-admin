/**
 * src/index.ts
 * Worker entry point. Exports fetch() and scheduled() handlers.
 * This is the ONLY file Cloudflare invokes directly.
 *
 * Pattern: thin router. All work is delegated to entry/* handlers,
 * which delegate to orchestrators, which delegate to services.
 *
 * The container is built per request. Within a request, the same container
 * is reused. Across requests, a new container may be built (Cloudflare
 * Workers may reuse isolates, but we don't rely on that).
 */

import type { Env } from "./types/env";
import { buildContainer } from "./container";
import { healthHandler, versionHandler, detailedHealthHandler } from "./entry/health";
import { webhookHandler } from "./entry/webhook";
import { cronHandler } from "./entry/cron";
import { debugHandler } from "./entry/debug";
import { tickHandler } from "./entry/tick";
import { managerHandler } from "./entry/manager";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ── Public endpoints ──

    // GET / — basic health check.
    if (request.method === "GET" && url.pathname === "/") {
      return healthHandler(env);
    }

    // GET /version — build info.
    if (request.method === "GET" && url.pathname === "/version") {
      return versionHandler();
    }

    // GET /health — detailed system status.
    if (request.method === "GET" && url.pathname === "/health") {
      return detailedHealthHandler(env);
    }

    // ── Internal endpoints (require CRON_KEY or DEBUG_TOKEN) ──

    // POST /internal/tick — external cron endpoint (auth via headers).
    if (request.method === "POST" && url.pathname === "/internal/tick") {
      const container = buildContainer(env);
      return tickHandler(request, { env, container });
    }

    // GET /internal/tick — also allow GET for easy testing (auth via headers).
    if (request.method === "GET" && url.pathname === "/internal/tick") {
      const container = buildContainer(env);
      return tickHandler(request, { env, container });
    }

    // GET /internal/health — same as /health but under /internal.
    if (request.method === "GET" && url.pathname === "/internal/health") {
      return detailedHealthHandler(env);
    }

    // GET /internal/version — same as /version but under /internal.
    if (request.method === "GET" && url.pathname === "/internal/version") {
      return versionHandler();
    }

    // ── Manager dashboard ──

    // /Manager or /manager — full debug dashboard.
    if (url.pathname === "/Manager" || url.pathname === "/manager" || url.pathname.startsWith("/Manager/") || url.pathname.startsWith("/manager/")) {
      const container = buildContainer(env);
      return managerHandler(request, url, { env, container });
    }

    // ── Debug dashboard ──

    // /debug/* — legacy debug dashboard (requires DEBUG_TOKEN).
    if (url.pathname === "/debug" || url.pathname.startsWith("/debug/")) {
      const container = buildContainer(env);
      return debugHandler(request, url, { env, container });
    }

    // ── Telegram webhook ──

    // GET /webhook/info — bot info.
    if (request.method === "GET" && url.pathname === "/webhook/info") {
      const container = buildContainer(env);
      const me = await container.tg.getMe();
      return new Response(JSON.stringify(me, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /webhook — Telegram update.
    if (request.method === "POST" && url.pathname === "/webhook") {
      const container = buildContainer(env);
      return webhookHandler(request, { env, container, ctx });
    }

    return new Response("Not Found", { status: 404 });
  },

  // Cloudflare Cron Triggers — disabled (using external cron via /internal/tick).
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const container = buildContainer(env);
    await cronHandler(event, { env, container, ctx });
  },
};
