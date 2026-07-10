/**
 * src/services/debug-service.ts
 * Debug system: pluggable test endpoints, status, log management.
 *
 * Reused pattern from AI Admin src/debug.js, extended with:
 *   - Pluggable test registration (plugins call registerTest in container.ts).
 *   - Environment introspection with secret masking.
 *   - Status endpoint showing all subsystem health.
 *
 * See ARCHITECTURE_RULES.md §11.
 */

import { DEBUG_RING_BUFFER_CAPACITY } from "../core/constants";
import type { DebugEvent, DebugStatus, DebugTest } from "../types/debug";
import type { Env } from "../types/env";
import type { Logger } from "./logger";
import type { KVStore } from "./kv-store";

export interface DebugServiceDeps {
  readonly kv: KVStore;
  readonly env: Env;
  readonly logger: Logger;
  readonly isDebugMode: () => boolean;
}

/** Mask a secret value: show only first 3 chars + ellipsis. */
export function maskValue(label: string, value: string | undefined): string {
  if (!value) return `${label}: (not set)`;
  if (value.length <= 3) return `${label}: ***`;
  return `${label}: ${value.slice(0, 3)}***`;
}

/** Check whether a value is "truthy" for status reporting. */
function isTruthy(value: string | undefined): boolean {
  return !!value && value.length > 0;
}

export class DebugService {
  private readonly tests = new Map<string, DebugTest>();

  constructor(private readonly deps: DebugServiceDeps) {}

  // ────────────────────────────────────────────────────────────
  // Test registration (pluggable)
  // ────────────────────────────────────────────────────────────

  /** Register a debug test endpoint. Plugins call this in container.ts. */
  registerTest(test: DebugTest): void {
    if (this.tests.has(test.name)) {
      console.warn(`[debug] overwriting test "${test.name}"`);
    }
    this.tests.set(test.name, test);
  }

  /** List all registered tests. */
  listTests(): readonly DebugTest[] {
    return Array.from(this.tests.values());
  }

  /** Run a registered test by name. */
  async runTest(name: string): Promise<unknown> {
    const test = this.tests.get(name);
    if (!test) {
      throw new Error(`Debug test "${name}" not registered. Available: ${Array.from(this.tests.keys()).join(", ")}`);
    }
    return test.run(this.deps.env);
  }

  // ────────────────────────────────────────────────────────────
  // Status endpoint (env introspection with secret masking)
  // ────────────────────────────────────────────────────────────

  /** Get full debug status. Used by /debug/api/status. */
  async getStatus(): Promise<DebugStatus & {
    readonly env: Readonly<Record<string, unknown>>;
    readonly ringBufferCapacity: number;
  }> {
    const counts = await this.deps.logger.counts();
    return {
      enabled: this.deps.isDebugMode(),
      ringBufferCapacity: DEBUG_RING_BUFFER_CAPACITY,
      events: counts.updates,
      errors: counts.errors,
      rawRequests: counts.rawRequests,
      env: this.maskedEnv(),
    };
  }

  /** Get a masked view of env (for /debug/api/status). */
  private maskedEnv(): Readonly<Record<string, unknown>> {
    const env = this.deps.env;
    return {
      // Non-secret
      ADMIN_ID: env.ADMIN_ID,
      TARGET_CHANNEL: env.TARGET_CHANNEL,
      FOOTER_TEXT: env.FOOTER_TEXT,
      DEBUG_MODE: env.DEBUG_MODE,
      DEFAULT_AI_PROVIDER: env.DEFAULT_AI_PROVIDER,
      DEFAULT_LANGUAGE: env.DEFAULT_LANGUAGE,
      SCHEDULER_TIMEZONE: env.SCHEDULER_TIMEZONE,
      SCHEDULE_SLOTS: env.SCHEDULE_SLOTS,
      SCHEDULE_JITTER_MINUTES: env.SCHEDULE_JITTER_MINUTES,
      // Secrets (masked)
      BOT_TOKEN: maskValue("BOT_TOKEN", env.BOT_TOKEN),
      GEMINI_API_KEY: maskValue("GEMINI_API_KEY", env.GEMINI_API_KEY),
      OPENROUTER_API_KEY: maskValue("OPENROUTER_API_KEY", env.OPENROUTER_API_KEY),
      GITHUB_TOKEN: maskValue("GITHUB_TOKEN", env.GITHUB_TOKEN),
      NEWSAPI_KEY: maskValue("NEWSAPI_KEY", env.NEWSAPI_KEY),
      NASA_API_KEY: maskValue("NASA_API_KEY", env.NASA_API_KEY),
      WEBHOOK_SECRET: maskValue("WEBHOOK_SECRET", env.WEBHOOK_SECRET),
      DEBUG_TOKEN: maskValue("DEBUG_TOKEN", env.DEBUG_TOKEN),
      // Booleans for quick health check
      has_bot_token: isTruthy(env.BOT_TOKEN),
      has_admin_id: isTruthy(env.ADMIN_ID),
      has_kv: !!env.SETTINGS,
      has_gemini: isTruthy(env.GEMINI_API_KEY),
      has_openrouter: isTruthy(env.OPENROUTER_API_KEY),
      has_github: isTruthy(env.GITHUB_TOKEN),
      has_newsapi: isTruthy(env.NEWSAPI_KEY),
      has_nasa: isTruthy(env.NASA_API_KEY),
      has_webhook_secret: isTruthy(env.WEBHOOK_SECRET),
      has_debug_token: isTruthy(env.DEBUG_TOKEN),
    };
  }

  // ────────────────────────────────────────────────────────────
  // Log management
  // ────────────────────────────────────────────────────────────

  /** Get recent updates (info-level events). */
  async getRecentUpdates(): Promise<readonly DebugEvent[]> {
    return this.deps.logger.getRecentUpdates();
  }

  /** Get recent errors. */
  async getRecentErrors(): Promise<readonly DebugEvent[]> {
    return this.deps.logger.getRecentErrors();
  }

  /** Get recent raw webhook requests. */
  async getRecentRawRequests(): Promise<readonly DebugEvent[]> {
    return this.deps.logger.getRecentRawRequests();
  }

  /** Clear all debug logs. */
  async clearLogs(): Promise<void> {
    await this.deps.logger.clear();
  }

  // ────────────────────────────────────────────────────────────
  // Built-in tests (always available)
  // ────────────────────────────────────────────────────────────

  /** Test 1: ping — liveness check. */
  async ping(): Promise<{ ok: true; time: string; has_bot_token: boolean; has_kv: boolean }> {
    return {
      ok: true,
      time: new Date().toISOString(),
      has_bot_token: !!this.deps.env.BOT_TOKEN,
      has_kv: !!this.deps.env.SETTINGS,
    };
  }

  /** Test 2: KV read/write round-trip. */
  async testKv(): Promise<{ ok: boolean; written: string; read: string; match: boolean; error?: string }> {
    try {
      const testKey = "fredy:debug:_test_kv";
      const testValue = `test-${Date.now()}`;
      await this.deps.kv.set(testKey, testValue);
      const read = await this.deps.kv.get(testKey);
      await this.deps.kv.delete(testKey);
      return {
        ok: read === testValue,
        written: testValue,
        read: read ?? "",
        match: read === testValue,
      };
    } catch (error) {
      return {
        ok: false,
        written: "",
        read: "",
        match: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Test 3: send a test Telegram message to the admin's private chat. */
  async testTelegramMessage(chatId: number | string, message: string): Promise<{ ok: boolean; error?: string }> {
    try {
      // We use the env.BOT_TOKEN directly to avoid a circular dep with TelegramService.
      const url = `https://api.telegram.org/bot${this.deps.env.BOT_TOKEN}/sendMessage`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
      });
      const data = (await response.json()) as { ok: boolean; description?: string };
      return { ok: data.ok, error: data.description };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
