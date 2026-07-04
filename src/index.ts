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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // GET / — basic health check (public, minimal).
    if (request.method === "GET" && url.pathname === "/") {
      return healthHandler(env);
    }

    // GET /version — build info (public).
    if (request.method === "GET" && url.pathname === "/version") {
      return versionHandler();
    }

    // GET /health — detailed system status (public, no secrets).
    if (request.method === "GET" && url.pathname === "/health") {
      return detailedHealthHandler(env);
    }

    // /debug/* — debug dashboard and test endpoints (requires DEBUG_TOKEN).
    if (url.pathname === "/debug" || url.pathname.startsWith("/debug/")) {
      const container = buildContainer(env);
      return debugHandler(request, url, { env, container });
    }

    // GET /webhook/info — bot info (useful for setup verification).
    if (request.method === "GET" && url.pathname === "/webhook/info") {
      const container = buildContainer(env);
      const me = await container.tg.getMe();
      return new Response(JSON.stringify(me, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /webhook — Telegram update handler.
    if (request.method === "POST" && url.pathname === "/webhook") {
      const container = buildContainer(env);
      return webhookHandler(request, { env, container, ctx });
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const container = buildContainer(env);
    await cronHandler(event, { env, container, ctx });
  },
};
