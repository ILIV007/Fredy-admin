/**
 * src/entry/health.ts
 * Health, version, and system status endpoints.
 *
 * Endpoints:
 *   GET /          — health check (public, no sensitive data)
 *   GET /version   — build info (public, version + phase + git info)
 *   GET /health    — detailed system status (public, no secrets)
 */

import type { Env } from "../types/env";

const VERSION = "3.5.2";
const PHASE = "production";
const BUILD_DATE = "2026-07-12";
const START_TIME = Date.now();

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

export interface VersionResponse {
  readonly name: string;
  readonly version: string;
  readonly phase: string;
  readonly buildDate: string;
  readonly runtime: string;
  readonly nodeVersion: string;
}

export interface DetailedHealthResponse {
  readonly ok: boolean;
  readonly status: "healthy" | "degraded" | "down";
  readonly version: string;
  readonly phase: string;
  readonly time: string;
  readonly uptime: string;
  readonly checks: {
    readonly kv: boolean;
    readonly botToken: boolean;
    readonly adminId: boolean;
    readonly geminiKey: boolean;
    readonly openRouterKey: boolean;
    readonly newsApiKey: boolean;
    readonly nasaApiKey: boolean;
    readonly githubToken: boolean;
    readonly webhookSecret: boolean;
    readonly debugToken: boolean;
  };
  readonly missingRequired: readonly string[];
  readonly missingRecommended: readonly string[];
}

/** GET / — basic health check (public, minimal info). */
export function healthHandler(env: Env): Response {
  const body: HealthResponse = {
    ok: true,
    name: "Fredy",
    version: VERSION,
    phase: PHASE,
    time: new Date().toISOString(),
    hasBotToken: !!env.BOT_TOKEN,
    hasKv: !!env.Fredy_SETTINGS,
    hasAdminId: !!env.ADMIN_ID,
    uptime: `${Math.floor((Date.now() - START_TIME) / 1000)}s`,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

/** GET /version — build info (public). */
export function versionHandler(): Response {
  const body: VersionResponse = {
    name: "Fredy",
    version: VERSION,
    phase: PHASE,
    buildDate: BUILD_DATE,
    runtime: "cloudflare-workers",
    nodeVersion: "V8 isolate",
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

/** GET /health — detailed system status (public, but no secrets). */
export function detailedHealthHandler(env: Env): Response {
  const checks = {
    kv: !!env.Fredy_SETTINGS,
    botToken: !!env.BOT_TOKEN,
    adminId: !!env.ADMIN_ID,
    geminiKey: !!env.GEMINI_API_KEY,
    openRouterKey: !!env.OPENROUTER_API_KEY,
    newsApiKey: !!env.NEWSAPI_KEY,
    nasaApiKey: !!env.NASA_API_KEY,
    githubToken: !!env.GITHUB_TOKEN,
    webhookSecret: !!env.WEBHOOK_SECRET,
    debugToken: !!env.DEBUG_TOKEN,
  };

  const missingRequired: string[] = [];
  const missingRecommended: string[] = [];

  if (!checks.kv) missingRequired.push("KV namespace (SETTINGS)");
  if (!checks.botToken) missingRequired.push("BOT_TOKEN");
  if (!checks.adminId) missingRequired.push("ADMIN_ID");
  if (!checks.geminiKey) missingRequired.push("GEMINI_API_KEY");
  if (!checks.openRouterKey) missingRequired.push("OPENROUTER_API_KEY");
  if (!checks.newsApiKey) missingRecommended.push("NEWSAPI_KEY");
  if (!checks.nasaApiKey) missingRecommended.push("NASA_API_KEY");
  if (!checks.webhookSecret) missingRecommended.push("WEBHOOK_SECRET");
  if (!checks.debugToken) missingRecommended.push("DEBUG_TOKEN");
  if (!checks.githubToken) missingRecommended.push("GITHUB_TOKEN (optional, higher rate limit)");

  const status: "healthy" | "degraded" | "down" =
    missingRequired.length > 0 ? "down" :
    missingRecommended.length > 0 ? "degraded" :
    "healthy";

  const body: DetailedHealthResponse = {
    ok: missingRequired.length === 0,
    status,
    version: VERSION,
    phase: PHASE,
    time: new Date().toISOString(),
    uptime: `${Math.floor((Date.now() - START_TIME) / 1000)}s`,
    checks,
    missingRequired,
    missingRecommended,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

/** Re-export version for other modules. */
export const FREDY_VERSION = VERSION;
export const FREDY_PHASE = PHASE;
export const FREDY_BUILD_DATE = BUILD_DATE;
