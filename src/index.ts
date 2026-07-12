/**
 * src/index.ts
 * Worker entry point.
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

    if (request.method === "GET" && url.pathname === "/") return healthHandler(env);
    if (request.method === "GET" && url.pathname === "/version") return versionHandler();
    if (request.method === "GET" && url.pathname === "/health") return detailedHealthHandler(env);

    if (url.pathname === "/internal/tick") {
      const container = buildContainer(env);
      return tickHandler(request, url, { env, container });
    }
    if (request.method === "GET" && url.pathname === "/internal/health") return detailedHealthHandler(env);
    if (request.method === "GET" && url.pathname === "/internal/version") return versionHandler();

    if (url.pathname === "/Manager" || url.pathname === "/manager" || url.pathname.startsWith("/Manager/") || url.pathname.startsWith("/manager/")) {
      const container = buildContainer(env);
      return managerHandler(request, url, { env, container });
    }

    if (url.pathname === "/debug" || url.pathname.startsWith("/debug/")) {
      const container = buildContainer(env);
      return debugHandler(request, url, { env, container });
    }

    if (request.method === "GET" && url.pathname === "/webhook/info") {
      const container = buildContainer(env);
      const me = await container.tg.getMe();
      return new Response(JSON.stringify(me, null, 2), { headers: { "Content-Type": "application/json" } });
    }

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
