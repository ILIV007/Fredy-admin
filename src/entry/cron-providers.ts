/**
 * src/entry/cron-providers.ts
 * v12.0.0 — Layer 2: Provider Refresh Cron (every 2 hours).
 *
 * This cron handles CONTENT PREPARATION — fetching from providers,
 * maintaining queue depth, and applying adaptive backoff. It does
 * NOT publish posts (that's Layer 1's job).
 *
 * RESPONSIBILITIES:
 *   ✅ Fetch content from due providers (GitHub, Dev.to, Reddit, News)
 *   ✅ Maintain queue depth (refill if below minimum per category)
 *   ✅ Apply adaptive backoff (slow down providers returning empty)
 *   ✅ Update provider health metrics
 *
 * DOES NOT:
 *   ❌ Publish posts (Layer 1 handles this)
 *   ❌ Generate daily plans (Layer 3 handles this)
 *   ❌ Check scheduledTime / fire slots
 *
 * QUEUE-DEPTH OPTIMIZATION:
 *   Before refreshing a provider, the engine checks if its category
 *   queue is already full. If GitHub's queue has 10 items and the
 *   target is 4, the refresh is SKIPPED — no wasted API calls.
 *   This keeps Gemini and provider API usage minimal.
 *
 * CONCURRENCY:
 *   Uses the same tick lock as Layer 1 to prevent overlap with
 *   an in-progress publish. The lock has a 90s TTL; if Layer 1 is
 *   mid-publish when Layer 2 fires, Layer 2 simply skips (the next
 *   2h tick will catch up).
 *
 * KV USAGE (per 2h tick):
 *   ~12 ticks/day × (lock + queue depth + provider refresh + stats)
 *   ≈ 60 reads, 30 writes/day
 *
 * See V12_ARCHITECTURE.md §4 for the full design rationale.
 */

import type { Env, Container } from "../types/env";
import type { Category } from "../types/category";
import type { FredySettings } from "../types/config";
import { acquireTickLock } from "../services/tick-lock";

const LAST_LOG_KEY = "fredy:tick:lastLog";
const LAST_TICK_KEY = "fredy:tick:lastTick";

export interface CronProvidersDeps {
  readonly env: Env;
  readonly container: Container;
  readonly ctx: ExecutionContext;
}

/**
 * Layer 2 handler — invoked by Cloudflare cron "0 star-slash-2 star star star" (every 2h).
 */
export async function cronProvidersHandler(deps: CronProvidersDeps): Promise<void> {
  const { env, container, ctx } = deps;
  ctx.waitUntil(runProviderRefresh(container, env));
}

/**
 * Provider refresh + queue maintenance.
 * Acquires the tick lock to avoid clashing with an in-progress publish.
 */
async function runProviderRefresh(container: Container, env: Env): Promise<void> {
  const startTime = Date.now();
  const log: string[] = [];

  // Acquire lock — if Layer 1 is mid-publish, skip this cycle.
  const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
  const lockTimeoutSec = settings?.scheduler?.lockTimeoutSec ?? 90;
  const tickLock = await acquireTickLock(container.kv, lockTimeoutSec);
  if (!tickLock.acquired) {
    // Another tick (likely a Layer 1 publish) is running — skip provider refresh.
    await container.kv.setJson(LAST_LOG_KEY, {
      time: Date.now(),
      tickTime: startTime,
      layer: "provider-refresh",
      skipped: true,
      reason: "lock_held",
      log: ["skipped: lock held (Layer 1 publish in progress)"],
    }, 3600).catch(() => {});
    return;
  }

  try {
    log.push("provider-refresh started");

    // ── 1. MAINTAIN QUEUE (refill if below minimum) ────
    // This is the primary content-generation path. It fetches from
    // providers via content.processForCategory() and enqueues results.
    if (settings) {
      await maintainQueue(container, settings, log);
    }

    // ── 2. PROVIDER ENGINE REFRESH (staggered) ────
    // Refresh due providers ONE AT A TIME, in priority order.
    // Respects adaptive backoff and queue depth (via the engine).
    try {
      const refreshResult = await container.providerEngine.refreshDueProviders(2);
      if (refreshResult.refreshed.length > 0) {
        log.push(`providers refreshed: ${refreshResult.refreshed.join(", ")}`);
      }
      if (refreshResult.skipped.length > 0) {
        log.push(`providers skipped: ${refreshResult.skipped.join(", ")}`);
      }
      if (refreshResult.failed.length > 0) {
        log.push(`providers failed: ${refreshResult.failed.join(", ")}`);
      }
      if (refreshResult.refreshed.length === 0 && refreshResult.skipped.length === 0 && refreshResult.failed.length === 0) {
        log.push("no providers due for refresh");
      }
    } catch (error) {
      log.push(`provider engine error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // ── 3. Flush batched stats ────
    await container.kv.flushAllStats().catch(() => {});
    log.push("cleanup done");

  } finally {
    await tickLock.release();

    // Write combined lastTick + lastLog.
    await container.kv.set(LAST_TICK_KEY, String(startTime)).catch(() => {});
    await container.kv.setJson(LAST_LOG_KEY, {
      time: Date.now(),
      tickTime: startTime,
      layer: "provider-refresh",
      durationMs: Date.now() - startTime,
      log,
    }, 3600).catch(() => {});
  }
}

// ────────────────────────────────────────────────────────────
// Queue Maintenance (smart refill — respects queue depth)
// ────────────────────────────────────────────────────────────

/**
 * Refill content queues that have fallen below their minimum depth.
 * Only generates content for categories that actually need it —
 * this avoids unnecessary provider API calls and Gemini usage.
 */
async function maintainQueue(
  container: Container,
  settings: FredySettings,
  log: string[],
): Promise<void> {
  const categories: Category[] = ["A", "B", "C"];
  const minMap: Record<Category, number> = {
    A: settings.content.queueMinA,
    B: settings.content.queueMinB,
    C: settings.content.queueMinC,
  };
  const targetMap: Record<Category, number> = {
    A: settings.content.queueTargetA,
    B: settings.content.queueTargetB,
    C: settings.content.queueTargetC,
  };

  // Batch depth checks — use depth() once instead of depthFor() per category.
  const allDepths = await container.queue.depth();
  const depthMap: Record<string, number> = {};
  for (const d of allDepths) {
    depthMap[d.category] = d.depth;
  }

  for (const cat of categories) {
    if (!settings.categories[cat].enabled) continue;

    const depth = depthMap[cat] ?? 0;
    const min = minMap[cat];
    const target = targetMap[cat];

    if (depth < min) {
      const needed = target - depth;
      log.push(`queue ${cat}: ${depth}/${min} — generating ${needed} items`);

      for (let i = 0; i < needed; i++) {
        try {
          const result = await container.content.processForCategory(cat, null, settings.language.default);
          if (result.ok) {
            log.push(`  ${cat}: generated ${result.content?.id ?? "?"}`);
          } else {
            log.push(`  ${cat}: generation failed — ${result.error ?? result.rejectedReason ?? "unknown"}`);
            break; // Stop if generation fails (likely no more content).
          }
        } catch (error) {
          log.push(`  ${cat}: generation error — ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }
    } else {
      log.push(`queue ${cat}: ${depth}/${min} OK`);
    }
  }
}
