/**
 * src/entry/manager.ts
 * /Manager — production-grade management dashboard v3.
 * Enhanced with: back-test, test-all plugins, copy buttons, full API.
 */

import type { Env, Container } from "../types/env";
import { APP_VERSION, APP_BUILD_DATE } from "../core/constants";
import { DEFAULT_WEEKLY_THEMES as DEFAULT_WEEKLY_THEMES_EXPORT } from "../core/config/sections/strategy";
import { escapeHtml } from "../primitives/strings";
import { reportBanner, reportRow, qualityRow } from "../primitives/report";

export interface ManagerHandlerDeps {
  readonly env: Env;
  readonly container: Container;
}

export async function managerHandler(
  request: Request,
  url: URL,
  deps: ManagerHandlerDeps,
): Promise<Response> {
  const { env, container } = deps;

  if (env.DEBUG_TOKEN) {
    const auth = request.headers.get("Authorization");
    const queryToken = url.searchParams.get("token");
    if (auth !== `Bearer ${env.DEBUG_TOKEN}` && queryToken !== env.DEBUG_TOKEN) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  if (url.pathname === "/Manager" || url.pathname === "/manager") {
    return new Response(managerHTML(env), { headers: {
      "Content-Type": "text/html; charset=utf-8",
      // v8.3.0: Allow inline scripts and eval for the Manager dashboard.
      // The dashboard uses inline <script> tags and template literals that
      // may trigger CSP violations on some browsers/CDN configurations.
      "Content-Security-Policy": "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'",
    } });
  }

  const apiPath = url.pathname.replace(/^\/[Mm]anager\/api\//, "");

  // ── Health ──
  if (apiPath === "health" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const stats = await container.kv.getGlobalStats().catch(() => ({ processed: 0, published: 0, rejected: 0, failed: 0 }));
    const state = await container.config.getState(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const schedStatus = await container.scheduler.status().catch(() => null);
    const queueDepths = await container.queue.depth().catch(() => []);
    // v9.2.1: lastRefresh removed — refreshSources() was a no-op stub whose
    // KV write was deleted. lastTick still tracks the most recent tick time.
    const lastTick = await container.kv.get("fredy:tick:lastTick").catch(() => null);
    return json({ ok: true, version: APP_VERSION, bot: { enabled: settings?.general.botEnabled, maintenance: settings?.general.maintenanceMode }, scheduler: { enabled: settings?.scheduler.enabled, nextSlot: schedStatus?.nextSlot, postsToday: schedStatus?.postsPublishedToday }, approveMode: settings?.approveMode, language: settings?.language.default, aiProvider: settings?.ai.primaryProvider, plugins: { enabled: container.plugins.list().filter(p => container.plugins.isEnabled(p.metadata.id)).length, total: container.plugins.list().length }, categories: { A: settings?.categories.A.enabled, B: settings?.categories.B.enabled, C: settings?.categories.C.enabled }, stats, state, queueDepths, lastTick: lastTick ? Number(lastTick) : null, hasSecrets: { botToken: !!env.BOT_TOKEN, gemini: !!env.GEMINI_API_KEY, openrouter: !!env.OPENROUTER_API_KEY, newsapi: !!env.NEWSAPI_KEY, nasa: !!env.NASA_API_KEY, github: !!env.GITHUB_TOKEN, cronKey: !!env.CRON_KEY, webhookSecret: !!env.WEBHOOK_SECRET, debugToken: !!env.DEBUG_TOKEN } });
  }

  // ── Plugins ──
  if (apiPath === "plugins" && request.method === "GET") {
    try {
      const plugins = container.plugins.list().map(p => {
        const status = container.plugins.getStatus(p.metadata.id);
        return {
          id: p.metadata.id,
          name: p.metadata.name,
          version: p.metadata.version,
          category: p.metadata.category,
          tier: p.getTier(),  // v11.7.1: Added tier field for Post to Channel grouping
          priority: p.metadata.priority,
          enabled: container.plugins.isEnabled(p.metadata.id),
          supportsImages: p.metadata.supportsImages,
          rateLimit: p.metadata.rateLimit,
          homepage: p.metadata.homepage,
          displayIcon: p.metadata.displayIcon ?? "",  // v11.7.1: Added display fields
          displaySource: p.metadata.displaySource ?? "",
          lastItemCount: status.lastItemCount ?? null,  // v11.7.1: Added last item count
        };
      });
      let statuses: Record<string, unknown> = {};
      try { statuses = container.plugins.getAllStatuses() as unknown as Record<string, unknown>; } catch { /* non-fatal */ }
      return json({ ok: true, plugins, statuses });
    } catch (error) {
      return json({ ok: false, error: errMsg(error), plugins: [] }, 200);
    }
  }

  // ── Test All Plugins ──
  if (apiPath === "test/all-plugins" && request.method === "POST") {
    const plugins = container.plugins.list().filter(p => container.plugins.isEnabled(p.metadata.id));
    const results = [];
    for (const p of plugins) {
      try {
        const items = await container.plugins.fetchFrom(p.metadata.id);
        results.push({ id: p.metadata.id, ok: true, itemCount: items.length });
      } catch (error) {
        results.push({ id: p.metadata.id, ok: false, error: errMsg(error) });
      }
    }
    return json({ ok: true, results });
  }

  // ── Back-test (full system test) ──
  if (apiPath === "backtest" && request.method === "POST") {
    const results: Array<{ test: string; ok: boolean; detail: string; durationMs: number }> = [];

    // 1. KV test
    try {
      const t0 = Date.now();
      await container.kv.set("fredy:_backtest", "ok", 60);
      const val = await container.kv.get("fredy:_backtest");
      await container.kv.delete("fredy:_backtest");
      results.push({ test: "KV Read/Write", ok: val === "ok", detail: val === "ok" ? "OK" : "Value mismatch", durationMs: Date.now() - t0 });
    } catch (e) { results.push({ test: "KV Read/Write", ok: false, detail: errMsg(e), durationMs: 0 }); }

    // 2. Config test
    try {
      const t0 = Date.now();
      const s = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
      results.push({ test: "Config Load", ok: !!s, detail: s ? "Settings loaded" : "No settings", durationMs: Date.now() - t0 });
    } catch (e) { results.push({ test: "Config Load", ok: false, detail: errMsg(e), durationMs: 0 }); }

    // 3. Telegram test
    try {
      const t0 = Date.now();
      const me = await container.tg.getMe();
      results.push({ test: "Telegram API", ok: me.ok, detail: me.ok ? `@${me.result?.username}` : "Failed", durationMs: Date.now() - t0 });
    } catch (e) { results.push({ test: "Telegram API", ok: false, detail: errMsg(e), durationMs: 0 }); }

    // 4. AI test
    try {
      const t0 = Date.now();
      const soul = await container.soul.load();
      const r = await container.ai.generate({ category: "A", source: "test", raw: { id: "test", source: "test", category: "A" as const, title: "Test", body: "Hello world", url: "https://example.com", fetchedAt: Date.now() }, language: "en", soul });
      results.push({ test: "AI Generation", ok: r.ok, detail: r.ok ? `${r.provider}/${r.model} (${r.tokensUsed} tokens)` : r.error ?? "Failed", durationMs: Date.now() - t0 });
    } catch (e) { results.push({ test: "AI Generation", ok: false, detail: errMsg(e), durationMs: 0 }); }

    // 5. Plugin test (first enabled)
    try {
      const t0 = Date.now();
      const firstPlugin = container.plugins.list().find(p => container.plugins.isEnabled(p.metadata.id));
      if (firstPlugin) {
        const items = await container.plugins.fetchFrom(firstPlugin.metadata.id);
        results.push({ test: "Plugin Fetch", ok: items.length >= 0, detail: `${firstPlugin.metadata.id}: ${items.length} items`, durationMs: Date.now() - t0 });
      } else {
        results.push({ test: "Plugin Fetch", ok: false, detail: "No enabled plugins", durationMs: 0 });
      }
    } catch (e) { results.push({ test: "Plugin Fetch", ok: false, detail: errMsg(e), durationMs: 0 }); }

    // 6. Queue test
    try {
      const t0 = Date.now();
      const depths = await container.queue.depth();
      const total = depths.reduce((s, d) => s + d.depth, 0);
      results.push({ test: "Queue Status", ok: true, detail: `Total: ${total} items`, durationMs: Date.now() - t0 });
    } catch (e) { results.push({ test: "Queue Status", ok: false, detail: errMsg(e), durationMs: 0 }); }

    // 7. Scheduler test
    try {
      const t0 = Date.now();
      const status = await container.scheduler.status();
      results.push({ test: "Scheduler", ok: true, detail: `Enabled: ${status.enabled}, Next: ${status.nextSlot?.time ?? "—"}`, durationMs: Date.now() - t0 });
    } catch (e) { results.push({ test: "Scheduler", ok: false, detail: errMsg(e), durationMs: 0 }); }

    // 8. History test
    try {
      const t0 = Date.now();
      const today = await container.history.getToday();
      results.push({ test: "History", ok: true, detail: `${today.entries.length} entries today`, durationMs: Date.now() - t0 });
    } catch (e) { results.push({ test: "History", ok: false, detail: errMsg(e), durationMs: 0 }); }

    // 9. Secrets check
    const required = ["BOT_TOKEN", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "CRON_KEY"];
    const missing = required.filter(k => !env[k as keyof typeof env]);
    results.push({ test: "Secrets", ok: missing.length === 0, detail: missing.length === 0 ? "All required secrets set" : `Missing: ${missing.join(", ")}`, durationMs: 0 });

    const allOk = results.every(r => r.ok);
    return json({ ok: allOk, results, summary: `${results.filter(r => r.ok).length}/${results.length} passed` });
  }

  // ── Queue ──
  if (apiPath === "queue" && request.method === "GET") {
    const depths = await container.queue.depth().catch(() => []);
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    // Also fetch actual queued items for display.
    // v9.2.1: Sort by enqueuedAt DESC so newest items appear first.
    const items: Record<string, unknown[]> = {};
    for (const cat of ["A", "B", "C"] as const) {
      try {
        const queued = await container.queue.listItems(cat);
        const mapped = queued.map(q => ({
          id: q.content.id,
          headline: q.content.headline ?? "(no headline)",
          pluginId: q.content.pluginId,
          language: q.content.language,
          qualityScore: q.content.quality.overallScore,
          qualityPassed: q.content.quality.passed,
          qualityDimensions: q.content.quality.dimensionScores.map(d => ({ dimension: d.dimension, score: d.score })),
          enqueuedAt: q.enqueuedAt,
          expiresAt: q.expiresAt,
          fetchedAt: q.content.fetchedAt,
          sourceUrl: q.content.sourceUrl,
          aiProvider: q.content.aiProvider,
          aiModel: q.content.aiModel,
          hasMedia: !!q.content.media,
        }));
        // Sort by enqueuedAt descending (newest first).
        mapped.sort((a, b) => (b.enqueuedAt as number) - (a.enqueuedAt as number));
        items[cat] = mapped;
      } catch { items[cat] = []; }
    }
    return json({ ok: true, depths, limits: settings ? { A: { min: settings.content.queueMinA, target: settings.content.queueTargetA }, B: { min: settings.content.queueMinB, target: settings.content.queueTargetB }, C: { min: settings.content.queueMinC, target: settings.content.queueTargetC } } : null, items, serverTime: Date.now() });
  }

  // ── Queue: delete item ──
  const queueDeleteMatch = apiPath.match(/^queue\/([ABC])\/delete$/);
  if (queueDeleteMatch && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { contentId?: string };
    const cat = queueDeleteMatch[1] as "A" | "B" | "C";
    if (!body.contentId) return json({ ok: false, error: "Missing contentId" }, 400);
    const deleted = await container.queue.deleteItem(cat, body.contentId);
    return json({ ok: deleted, message: deleted ? "Item deleted" : "Item not found" });
  }

  // ── Queue: send now (publish a specific queue item immediately) ──
  const queueSendMatch = apiPath.match(/^queue\/([ABC])\/send-now$/);
  if (queueSendMatch && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { contentId?: string };
    const cat = queueSendMatch[1] as "A" | "B" | "C";
    if (!body.contentId) return json({ ok: false, error: "Missing contentId" }, 400);
    try {
      const items = await container.queue.listItems(cat);
      const target = items.find(q => q.content.id === body.contentId);
      if (!target) return json({ ok: false, error: "Item not found in queue" });
      const pubResult = await container.finalPublisher.publish(target.content);
      if (pubResult.ok) {
        await container.queue.deleteItem(cat, body.contentId);
        // v9.3.1: Record in dedup store ONLY after successful publish.
        await container.duplicateDetector.recordPublished(target.content).catch(() => {});
        const adminId = Number(env.ADMIN_ID ?? "0");
        if (adminId > 0) {
          // Send formatted post to admin PM.
          try {
            const finalPost = await container.uxLayer.transform(target.content);
            if (finalPost.media && finalPost.media.type === "image" && finalPost.media.url) {
              const photoResult = await container.tg.sendPhoto(adminId, finalPost.media.url, finalPost.caption, { parse_mode: "HTML" });
              if (!photoResult.ok) {
                await container.tg.sendMessage(adminId, finalPost.fullText, { parse_mode: "HTML" }).catch(() => {});
              }
            } else {
              await container.tg.sendMessage(adminId, finalPost.fullText, { parse_mode: "HTML" }).catch(() => {});
            }
          } catch {}
          // Send summary report.
          await container.tg.sendMessage(adminId, [
            ``,
            reportBanner("📤", `QUEUE SEND NOW — CAT ${cat}`),
            ``,
            ``,
            reportRow("🔌", "Source Plugin", target.content.pluginId),
            reportRow("🤖", "AI Model", `${target.content.aiProvider}/${target.content.aiModel}`),
            qualityRow(target.content.quality.overallScore),
            reportRow("📤", "Channel Message ID", String(pubResult.telegramMessageId)),
            reportRow("🔖", "Content ID", target.content.id),
            reportRow("🔗", "Source URL", target.content.sourceUrl ?? "(none)"),
          ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        }
        return json({ ok: true, messageId: pubResult.telegramMessageId });
      }
      return json({ ok: false, error: pubResult.error ?? "Publish failed" });
    } catch (error) {
      return json({ ok: false, error: errMsg(error) }, 500);
    }
  }

  // ── AI ──
  if (apiPath === "ai" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const providers = container.providers.listWithStatus();
    const tokenStats = container.ai.getTokenStats();
    // Build models list with usage priority (from settings.providers config).
    const providerConfig = settings?.providers;
    const modelsByProvider: Record<string, Array<{ model: string; priority: number; enabled: boolean }>> = {};
    for (const p of providers) {
      const cfg = providerConfig?.[p.id as "gemini" | "openrouter"];
      modelsByProvider[p.id] = (cfg?.models ?? []).map((model: string, idx: number) => ({
        model,
        priority: idx + 1, // 1 = first tried, 2 = second, etc.
        enabled: p.enabled && p.configured,
      }));
    }
    return json({ ok: true, settings: settings?.ai, providers, modelsByProvider, tokenStats });
  }

  // ── Test specific AI model ──
  const aiModelMatch = apiPath.match(/^test\/ai\/([\w-]+)\/(.+)$/);
  if (aiModelMatch && request.method === "POST") {
    const providerId = aiModelMatch[1]!;
    const model = aiModelMatch[2]!;
    try {
      const providers = container.providers.list().filter((p) => p.id === providerId && p.isConfigured(env));
      if (providers.length === 0) {
        return json({ ok: false, error: `Provider ${providerId} not configured` }, 400);
      }
      const provider = providers[0]!;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await provider.complete({
          system: "You are a helpful assistant. Reply in English.",
          user: "Say hello in one sentence.",
          model,
          jsonMode: false,
          maxTokens: 100,
          temperature: 0.7,
        }, controller.signal);
        clearTimeout(timeout);
        return json({
          ok: true,
          provider: providerId,
          model,
          text: response.text?.slice(0, 300),
          tokensUsed: response.tokensUsed,
          latencyMs: response.latencyMs,
        });
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    } catch (error) {
      return json({ ok: false, provider: providerId, model, error: errMsg(error) }, 500);
    }
  }

  // ── Scheduler ──
  if (apiPath === "scheduler" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const status = await container.scheduler.status().catch(() => null);
    return json({ ok: true, settings: settings?.scheduler, status });
  }

  // v12.0.3: Combined dashboard overview — 1 API call instead of 3.
  // Returns health + scheduler debug summary + recent history + next slot.
  if (apiPath === "dashboard/overview" && request.method === "GET") {
    try {
      const now = Date.now();
      const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
      const tz = settings?.scheduler?.timezone || "UTC";

      // Current time in configured timezone
      const { formatDateInZone } = await import("../primitives/time");
      const today = formatDateInZone(now, tz);
      const localTime = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).format(new Date(now));

      // Scheduler status
      const schedStatus = await container.scheduler.status().catch(() => null);

      // Strategy plan (for next scheduledTime + countdown)
      const plan = await container.strategyEngine.getOrGeneratePlan().catch(() => null);
      const nowInTz = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(now));
      const [nowH, nowM] = nowInTz.split(":").map(Number);
      const nowMinutes = (nowH ?? 0) * 60 + (nowM ?? 0);

      const slots = plan?.posts ?? [];
      // v12.0.2: exact comparison — pending = scheduledTime strictly in future
      const nextPost = slots.find((s) => {
        if (s.status !== "pending") return false;
        const schedTime = s.scheduledTime ?? s.time;
        const [sH, sM] = schedTime.split(":").map(Number);
        const schedMin = (sH ?? 0) * 60 + (sM ?? 0);
        return nowMinutes < schedMin;
      }) ?? null;

      let nextPostInfo: Record<string, unknown> | null = null;
      if (nextPost) {
        const schedTime = nextPost.scheduledTime ?? nextPost.time;
        const [sH, sM] = schedTime.split(":").map(Number);
        const schedMin = (sH ?? 0) * 60 + (sM ?? 0);
        const remainingMin = schedMin - nowMinutes;
        nextPostInfo = {
          index: nextPost.index,
          window: `${nextPost.time}-${nextPost.windowEnd ?? nextPost.time}`,
          scheduledTime: schedTime,
          category: nextPost.category,
          provider: nextPost.provider,
          remainingMinutes: remainingMin,
          remainingLabel: remainingMin > 0
            ? (remainingMin >= 60 ? `${Math.floor(remainingMin / 60)}h ${remainingMin % 60}m` : `${remainingMin}m`)
            : "due now",
        };
      }

      // Recent history (last 5 publishes)
      const recentHistory = await container.history.getRecent(5).catch(() => []);

      // Quiet hours status (computed live, zero KV)
      const isQuiet = settings
        ? (container.quietHoursChecker?.isQuietHours(now, settings.scheduler) ?? false)
        : false;

      // Global stats
      const state = await container.config.getState(Number(env.ADMIN_ID ?? "0")).catch(() => null);

      // Queue depths
      const queueDepths = await container.queue.depth().catch(() => []);

      return json({
        ok: true,
        version: APP_VERSION,
        currentTime: {
          epoch: now, iso: new Date(now).toISOString(), localTime, timezone: tz, date: today,
        },
        scheduler: {
          enabled: settings?.scheduler?.enabled ?? false,
          postsToday: schedStatus?.postsPublishedToday ?? 0,
          postsByCategory: schedStatus?.postsByCategoryToday ?? { A: 0, B: 0, C: 0 },
          nextSlot: schedStatus?.nextSlot ?? null,
        },
        bot: {
          enabled: settings?.general?.botEnabled ?? false,
          maintenanceMode: settings?.general?.maintenanceMode ?? false,
        },
        approveMode: settings?.approveMode ?? false,
        aiProvider: settings?.ai?.primaryProvider ?? "—",
        language: settings?.language?.default ?? "—",
        plugins: {
          enabled: container.plugins.list().filter(p => container.plugins.isEnabled(p.metadata.id)).length,
          total: container.plugins.list().length,
        },
        quietHours: {
          active: isQuiet,
          config: settings?.scheduler?.quietHours ?? null,
          nextActiveTime: settings?.scheduler?.quietHours?.end ?? null,
        },
        nextPost: nextPostInfo,
        recentPublishes: recentHistory.slice(0, 5).map((e) => ({
          publishedAt: e.publishedAt,
          agoMinutes: Math.round((now - e.publishedAt) / 60000),
          category: e.category,
          pluginId: e.pluginId,
          qualityScore: e.qualityScore,
          textPreview: e.textPreview.slice(0, 80),
          sourceUrl: e.sourceUrl,
        })),
        stats: {
          processed: state?.stats?.processed ?? 0,
          published: state?.stats?.published ?? 0,
          rejected: state?.stats?.rejected ?? 0,
          failed: state?.stats?.failed ?? 0,
        },
        queueDepths,
        lastTick: await container.kv.get("fredy:tick:lastTick").catch(() => null),
        hasSecrets: {
          botToken: !!env.BOT_TOKEN, gemini: !!env.GEMINI_API_KEY,
          openrouter: !!env.OPENROUTER_API_KEY, cronKey: !!env.CRON_KEY,
        },
      });
    } catch (error) {
      return json({ ok: false, error: errMsg(error) }, 500);
    }
  }


  // ── History ──
  if (apiPath === "history" && request.method === "GET") {
    const today = await container.history.getToday().catch(() => ({ entries: [], total: 0, date: "" }));
    const recent = await container.history.getRecent(7).catch(() => []);
    return json({ ok: true, today, recent });
  }

  // v12.0.4: Statistics overview — aggregated 7-day data for charts + heatmap.
  if (apiPath === "statistics/overview" && request.method === "GET") {
    try {
      const { formatDateInZone } = await import("../primitives/time");
      const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
      const tz = settings?.scheduler?.timezone || "UTC";
      const recent = await container.history.getRecent(7).catch(() => []);

      // Aggregate by category
      const byCategory: Record<string, number> = { A: 0, B: 0, C: 0 };
      // Aggregate by plugin
      const byPlugin: Record<string, number> = {};
      // Aggregate by hour-of-day (0-23) for heatmap
      const byHour: number[] = new Array(24).fill(0);
      // Aggregate by day-of-week (0=Sun..6=Sat)
      const byDayOfWeek: number[] = new Array(7).fill(0);
      // Quality score distribution (buckets: 0-20, 20-40, 40-60, 60-80, 80-100)
      const qualityBuckets = [0, 0, 0, 0, 0];
      // Daily totals (last 7 days, oldest first)
      const dailyTotals: Array<{ date: string; count: number }> = [];
      // Tokens + cost
      let totalTokens = 0;
      let totalCost = 0;
      let totalQuality = 0;
      let qualityCount = 0;

      // Build daily totals map
      const dailyMap: Record<string, number> = {};
      for (const e of recent) {
        const date = formatDateInZone(e.publishedAt, tz);
        dailyMap[date] = (dailyMap[date] ?? 0) + 1;
      }
      // Build sorted daily array (last 7 days, oldest first)
      const now = Date.now();
      for (let i = 6; i >= 0; i--) {
        const date = formatDateInZone(now - i * 24 * 3600 * 1000, tz);
        dailyTotals.push({ date, count: dailyMap[date] ?? 0 });
      }

      // Process each entry
      for (const e of recent) {
        byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
        byPlugin[e.pluginId] = (byPlugin[e.pluginId] ?? 0) + 1;

        // Hour of day in timezone
        const dtf = new Intl.DateTimeFormat("en-US", {
          timeZone: tz, hour: "2-digit", hour12: false,
        });
        const hourStr = dtf.format(new Date(e.publishedAt));
        const hour = parseInt(hourStr, 10);
        if (hour >= 0 && hour < 24) byHour[hour]!++;

        // Day of week
        const dayDtf = new Intl.DateTimeFormat("en-US", {
          timeZone: tz, weekday: "short",
        });
        const weekday = dayDtf.format(new Date(e.publishedAt));
        const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const dow = dayMap[weekday] ?? 0;
        byDayOfWeek[dow]!++;

        // Quality bucket
        if (e.telegramMessageId > 0) {
          const q = e.qualityScore;
          const bucket = Math.min(4, Math.floor(q / 20));
          qualityBuckets[bucket]!++;
          totalQuality += q;
          qualityCount++;
        }

        totalTokens += e.tokensUsed;
        totalCost += e.estimatedCost;
      }

      // Sort plugins by count (descending)
      const topPlugins = Object.entries(byPlugin)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([id, count]) => ({ id, count }));

      // Heatmap data: 7 days × 24 hours
      // Build a 7×24 matrix from the recent entries
      const heatmap: number[][] = [];
      for (let d = 0; d < 7; d++) {
        const row: number[] = new Array(24).fill(0);
        const date = formatDateInZone(now - (6 - d) * 24 * 3600 * 1000, tz);
        for (const e of recent) {
          const eDate = formatDateInZone(e.publishedAt, tz);
          if (eDate !== date) continue;
          const dtf = new Intl.DateTimeFormat("en-US", {
            timeZone: tz, hour: "2-digit", hour12: false,
          });
          const hour = parseInt(dtf.format(new Date(e.publishedAt)), 10);
          if (hour >= 0 && hour < 24) row[hour]!++;
        }
        heatmap.push(row);
      }

      // Max value for heatmap color scaling
      const heatMax = Math.max(1, ...heatmap.flat());

      return json({
        ok: true,
        totalPosts: recent.length,
        avgQuality: qualityCount > 0 ? Math.round(totalQuality / qualityCount) : 0,
        totalTokens,
        totalCost: Number(totalCost.toFixed(4)),
        byCategory,
        topPlugins,
        byHour,
        byDayOfWeek,
        qualityBuckets,
        dailyTotals,
        heatmap,
        heatMax,
        days: 7,
      });
    } catch (error) {
      return json({ ok: false, error: errMsg(error) }, 500);
    }
  }

  // ── Logs ──
  if (apiPath === "logs" && request.method === "GET") {
    const updates = await container.debug.getRecentUpdates().catch(() => []);
    const errors = await container.debug.getRecentErrors().catch(() => []);
    // v9.2.3: Always-on failure ring buffer (independent of DEBUG_MODE).
    // Captures every scheduled-publish failure with full error + stage + plugin info.
    const failures = await container.scheduler.getRecentFailures().catch(() => []);
    return json({ ok: true, updates, errors, failures });
  }

  // v9.2.3: Clear the failure ring buffer.
  if (apiPath === "clear/failures" && request.method === "POST") {
    await container.scheduler.clearFailures().catch(() => {});
    return json({ ok: true });
  }

  // ── Config ──
  if (apiPath === "config" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    return json({ ok: true, settings, sections: container.config.listSections() });
  }

  // ── System ──
  if (apiPath === "system" && request.method === "GET") {
    return json({ ok: true, version: APP_VERSION, buildDate: APP_BUILD_DATE, runtime: "cloudflare-workers", kv: !!env.Fredy_SETTINGS, cacheStats: container.config.cacheStats(), pluginCount: container.plugins.list().length, providerCount: container.providers.list().length, hasSecrets: { botToken: !!env.BOT_TOKEN, gemini: !!env.GEMINI_API_KEY, openrouter: !!env.OPENROUTER_API_KEY, cronKey: !!env.CRON_KEY } });
  }

  // ── Test single plugin ──
  const pluginMatch = apiPath.match(/^test\/plugin\/([\w-]+)$/);
  if (pluginMatch && request.method === "POST") {
    try {
      const items = await container.plugins.fetchFrom(pluginMatch[1]!);
      return json({ ok: true, itemCount: items.length, items: items.slice(0, 3).map(i => ({ id: i.id, title: i.title, url: i.url })) });
    } catch (error) { return json({ ok: false, error: errMsg(error) }, 500); }
  }

  // ── Toggle plugin enable/disable ──
  const togglePluginMatch = apiPath.match(/^plugin\/([\w-]+)\/toggle$/);
  if (togglePluginMatch && request.method === "POST") {
    const pluginId = togglePluginMatch[1]!;
    const isCurrentlyEnabled = container.plugins.isEnabled(pluginId);
    if (isCurrentlyEnabled) {
      container.plugins.disable(pluginId);
    } else {
      container.plugins.enable(pluginId);
    }
    const newState = container.plugins.isEnabled(pluginId);
    return json({ ok: true, pluginId, enabled: newState });
  }

  // ── Test AI ──
  if (apiPath === "test/ai" && request.method === "POST") {
    try {
      const body = await request.json().catch(() => ({})) as { text?: string };
      const soul = await container.soul.load();
      const result = await container.ai.generate({ category: "A", source: "test", raw: { id: "test", source: "test", category: "A" as const, title: "Test", body: body.text ?? "Test about AI", url: "https://example.com", fetchedAt: Date.now() }, language: "en", soul });
      return json({ ok: result.ok, provider: result.provider, model: result.model, tokens: result.tokensUsed, score: result.quality?.overallScore, text: result.content?.text?.slice(0, 500), error: result.error });
    } catch (error) { return json({ ok: false, error: errMsg(error) }, 500); }
  }

  // ── Test Everything (comprehensive single-result test) ──
  if (apiPath === "test/everything" && request.method === "POST") {
    const report: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      version: APP_VERSION,
      sections: {} as Record<string, unknown>,
    };
    const sections = report["sections"] as Record<string, unknown>;

    // 1. System info
    try {
      const t0 = Date.now();
      sections["system"] = {
        ok: true,
        durationMs: Date.now() - t0,
        detail: {
          version: APP_VERSION,
          buildDate: APP_BUILD_DATE,
          kv: !!env.Fredy_SETTINGS,
          pluginCount: container.plugins.list().length,
          providerCount: container.providers.list().length,
          secrets: {
            botToken: !!env.BOT_TOKEN,
            gemini: !!env.GEMINI_API_KEY,
            openrouter: !!env.OPENROUTER_API_KEY,
            newsapi: !!env.NEWSAPI_KEY,
            nasa: !!env.NASA_API_KEY,
            github: !!env.GITHUB_TOKEN,
            cronKey: !!env.CRON_KEY,
            debugToken: !!env.DEBUG_TOKEN,
          },
        },
      };
    } catch (e) { sections["system"] = { ok: false, error: errMsg(e) }; }

    // 2. KV test
    try {
      const t0 = Date.now();
      await container.kv.set("fredy:_backtest", "ok", 60);
      const val = await container.kv.get("fredy:_backtest");
      await container.kv.delete("fredy:_backtest");
      sections["kv"] = { ok: val === "ok", durationMs: Date.now() - t0, detail: val === "ok" ? "Read/write OK" : "Value mismatch" };
    } catch (e) { sections["kv"] = { ok: false, error: errMsg(e) }; }

    // 3. Config test
    try {
      const t0 = Date.now();
      const s = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
      sections["config"] = { ok: !!s, durationMs: Date.now() - t0, detail: s ? "Settings loaded" : "No settings" };
    } catch (e) { sections["config"] = { ok: false, error: errMsg(e) }; }

    // 4. Telegram test
    try {
      const t0 = Date.now();
      const me = await container.tg.getMe();
      sections["telegram"] = { ok: me.ok, durationMs: Date.now() - t0, detail: me.ok ? `@${me.result?.username}` : "Failed" };
    } catch (e) { sections["telegram"] = { ok: false, error: errMsg(e) }; }

    // 5. AI test
    try {
      const t0 = Date.now();
      const soul = await container.soul.load();
      const r = await container.ai.generate({ category: "A", source: "test", raw: { id: "test", source: "test", category: "A" as const, title: "Test", body: "Hello world", url: "https://example.com", fetchedAt: Date.now() }, language: "en", soul });
      sections["ai"] = { ok: r.ok, durationMs: Date.now() - t0, detail: r.ok ? `${r.provider}/${r.model} (${r.tokensUsed} tokens)` : r.error ?? "Failed" };
    } catch (e) { sections["ai"] = { ok: false, error: errMsg(e) }; }

    // 6. All plugins test
    const pluginResults: Array<{ id: string; ok: boolean; itemCount: number; error?: string; durationMs: number }> = [];
    const plugins = container.plugins.list();
    for (const p of plugins) {
      const t0 = Date.now();
      try {
        const items = await container.plugins.fetchFrom(p.metadata.id);
        pluginResults.push({ id: p.metadata.id, ok: true, itemCount: items.length, durationMs: Date.now() - t0 });
      } catch (error) {
        pluginResults.push({ id: p.metadata.id, ok: false, itemCount: 0, error: errMsg(error), durationMs: Date.now() - t0 });
      }
    }
    sections["plugins"] = {
      ok: pluginResults.every((r) => r.ok),
      detail: `${pluginResults.filter((r) => r.ok).length}/${pluginResults.length} plugins OK`,
      results: pluginResults,
    };

    // 7. Queue test
    try {
      const t0 = Date.now();
      const depths = await container.queue.depth();
      const total = depths.reduce((s, d) => s + d.depth, 0);
      sections["queue"] = { ok: true, durationMs: Date.now() - t0, detail: `Total: ${total} items`, depths };
    } catch (e) { sections["queue"] = { ok: false, error: errMsg(e) }; }

    // 8. Scheduler test
    try {
      const t0 = Date.now();
      const status = await container.scheduler.status();
      sections["scheduler"] = { ok: true, durationMs: Date.now() - t0, detail: `Enabled: ${status.enabled}, Next: ${status.nextSlot?.time ?? "—"}` };
    } catch (e) { sections["scheduler"] = { ok: false, error: errMsg(e) }; }

    // 9. History test
    try {
      const t0 = Date.now();
      const today = await container.history.getToday();
      sections["history"] = { ok: true, durationMs: Date.now() - t0, detail: `${today.entries.length} entries today` };
    } catch (e) { sections["history"] = { ok: false, error: errMsg(e) }; }

    // Compute overall summary
    const allOk = Object.values(sections).every((s) => (s as { ok?: boolean }).ok === true);
    report["overallOk"] = allOk;
    report["summary"] = `${Object.values(sections).filter((s) => (s as { ok?: boolean }).ok === true).length}/${Object.keys(sections).length} sections passed`;

    return json(report);
  }

  // ── Strategy: get/set strategy mode ──
  if (apiPath === "strategy" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const strategy = settings?.strategy;
    const plan = await container.strategyEngine.getOrGeneratePlan().catch(() => null);
    // v12.0.12: Add weekly themes + Tier V entries for the redesigned Strategy page.
    const weeklyThemes = strategy?.weeklyThemesEnabled
      ? DEFAULT_WEEKLY_THEMES_EXPORT
      : null;
    const tierVEntries = settings?.tierV?.entries ?? [];
    // v12.1.3: Add Tier V published status (was NASA published today?)
    const tierVStatus = settings
      ? await container.tierVScheduler.getPublishedStatus(settings, Date.now()).catch(() => ({}))
      : {};
    return json({ ok: true, strategy, plan, weeklyThemes, tierVEntries, tierVStatus });
  }
  if (apiPath === "strategy" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const adminId = Number(env.ADMIN_ID ?? "0");
    const cur = await container.config.getSettings(adminId);
    const oldMode = cur.strategy.mode;
    const patch: Record<string, unknown> = { strategy: { ...cur.strategy, ...body } };
    const result = await container.config.updateSettings(adminId, patch);

    // v11.2.0: When strategy mode changes, clear BOTH plans + fired markers
    // (same as /strategy/regenerate). Previously only deleted the legacy
    // fredy:sched:slots key, leaving fredy:strategy:plan and fired markers
    // intact — causing the new plan's already-passed slots to re-fire.
    if (body.mode && body.mode !== oldMode) {
      try {
        const { formatDateInZone } = await import("../primitives/time");
        const { slotsKey } = await import("../core/storage/keys");
        const settings = await container.config.getSettings(adminId);
        const today = formatDateInZone(Date.now(), settings.scheduler.timezone);
        // v11.2.0: Clear BOTH plans (daily planner + strategy).
        await container.kv.delete(slotsKey(today));
        await container.kv.delete(`fredy:strategy:plan:${today}`);
        // v11.2.0: Clear all fired markers for today.
        const firedKeys = await container.kv.list(`fredy:sched:sent:${today}:`);
        for (const k of firedKeys) {
          await container.kv.delete(k).catch(() => {});
        }
        // Generate a new plan with the new strategy.
        await container.strategyEngine.generatePlan();

        // Notify admin about strategy change.
        if (adminId > 0) {
          await container.tg.sendMessage(adminId, [
            ``,
            `<b>━━━ 🎯 STRATEGY CHANGED ━━━</b>`,
            ``,
            ``,
            `<blockquote>📊 <b>Old:</b> ${oldMode}</blockquote>`,
            `<blockquote>📊 <b>New:</b> ${body.mode}</blockquote>`,
            `<blockquote>📅 <b>Date:</b> ${today}</blockquote>`,
            `<blockquote>🔄 <b>Plan + fired markers cleared. New plan generated.</b></blockquote>`,
          ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        }
      } catch (e) {
        console.warn("[manager] strategy change plan regeneration failed:", e);
      }
    }

    return json(result);
  }

  // ── Strategy: regenerate plan ──
  if (apiPath === "strategy/regenerate" && request.method === "POST") {
    // v8.7.0: Clear BOTH plans (daily planner + strategy) + fired markers.
    // v12.1.1: CRITICAL FIX — don't clear fired markers! When regenerating
    // mid-day, already-published slots must be preserved as "published" in
    // the new plan. Previously, clearing fired markers caused the scheduler
    // to re-fire ALL past slots (burst publishing + "window expired" errors).
    try {
      const { formatDateInZone } = await import("../primitives/time");
      const { slotsKey } = await import("../core/storage/keys");
      const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
      const today = formatDateInZone(Date.now(), settings.scheduler.timezone);
      // Clear daily planner plan.
      await container.kv.delete(slotsKey(today));
      // Clear strategy plan (fredy:strategy:plan:<date>).
      await container.kv.delete(`fredy:strategy:plan:${today}`);
      // v12.1.1: DO NOT clear fired markers — they're needed to prevent re-firing.
    } catch {}
    const plan = await container.strategyEngine.generatePlan();

    // v12.1.1: Mark past slots as "skipped" so the scheduler doesn't re-fire them.
    // Only FUTURE slots remain "pending". This prevents the burst-publish bug.
    try {
      const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
      const tz = settings.scheduler.timezone || "UTC";
      const nowInTz = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date());
      const [nowH, nowM] = nowInTz.split(":").map(Number);
      const nowMinutes = (nowH ?? 0) * 60 + (nowM ?? 0);

      for (const post of plan.posts) {
        const schedTime = post.scheduledTime ?? post.time;
        const [sH, sM] = schedTime.split(":").map(Number);
        const schedMin = (sH ?? 0) * 60 + (sM ?? 0);
        if (schedMin < nowMinutes) {
          // Past slot — mark as "skipped" so scheduler doesn't fire it.
          await container.strategyEngine.markPostSkipped(plan.date, post.index).catch(() => {});
        }
      }
    } catch { /* non-fatal */ }

    return json({ ok: true, plan });
  }

  // ── Debug: runtime info ──
  if (apiPath === "debug" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const tickLog = await container.tickLogger.load().catch(() => null);
    const pipelineLog = await container.pipelineLogger.load().catch(() => null);
    const cacheStats = container.config.cacheStats?.() ?? { size: 0, ttlMs: 0 };
    return json({
      ok: true,
      version: APP_VERSION,
      runtime: {
        scheduler: settings?.scheduler,
        strategy: settings?.strategy,
        ai: settings?.ai,
        language: settings?.language,
      },
      tickLog,
      pipelineLog,
      cacheStats,
      kvHealth: !!env.Fredy_SETTINGS,
      secrets: {
        botToken: !!env.BOT_TOKEN,
        gemini: !!env.GEMINI_API_KEY,
        openrouter: !!env.OPENROUTER_API_KEY,
        cronKey: !!env.CRON_KEY,
        github: !!env.GITHUB_TOKEN,
        nasa: !!env.NASA_API_KEY,
        newsapi: !!env.NEWSAPI_KEY,
      },
    });
  }

  // ── v11.2.0: Scheduler Debug endpoint ──
  // Provides a complete real-time snapshot of the scheduler state for debugging
  // publishing issues without reading logs.
  if (apiPath === "scheduler/debug" && request.method === "GET") {
    try {
      const now = Date.now();
      const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
      const tz = settings.scheduler.timezone || "UTC";

      // Current time in configured timezone
      const { formatDateInZone } = await import("../primitives/time");
      const today = formatDateInZone(now, tz);
      const localTime = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).format(new Date(now));

      // Strategy plan (the one the scheduler actually uses)
      const plan = await container.strategyEngine.getOrGeneratePlan().catch(() => null);

      // v11.16.0: Window-based analysis — no epochMs comparison.
      // v12.0.0: Fixed duplicate `const tz` — reuse the one declared above.
      const nowInTz = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(now));
      const [nowH, nowM] = nowInTz.split(":").map(Number);
      const nowMinutes = (nowH ?? 0) * 60 + (nowM ?? 0);

      const slots = plan?.posts ?? [];
      const completed = slots.filter((s) => s.status === "published" || s.status === "backup");
      // v12.0.2: EXACT scheduledTime comparison — no 10-min tolerance.
      // Pending = scheduledTime is still strictly in the future.
      const pending = slots.filter((s) => {
        if (s.status !== "pending") return false;
        const schedTime = s.scheduledTime ?? s.time;
        const [sH, sM] = schedTime.split(":").map(Number);
        const schedMin = (sH ?? 0) * 60 + (sM ?? 0);
        return nowMinutes < schedMin;
      });
      // v12.0.2: Due NOW = scheduledTime has been reached (now >= scheduledMin)
      const dueNow = slots.filter((s) => {
        if (s.status !== "pending") return false;
        const schedTime = s.scheduledTime ?? s.time;
        const [sH, sM] = schedTime.split(":").map(Number);
        const schedMin = (sH ?? 0) * 60 + (sM ?? 0);
        return nowMinutes >= schedMin;
      });
      const failed = slots.filter((s) => s.status === "failed");
      const publishing = slots.filter((s) => s.status === "publishing");

      // Next window (first pending whose start is in the future)
      const nextSlot = pending.length > 0 ? pending[0] : null;

      // Last tick
      const lastTickStr = await container.kv.get("fredy:tick:lastTick").catch(() => null);
      const lastTick = lastTickStr ? Number(lastTickStr) : null;

      // Lock status
      const lockValue = await container.kv.get("fredy:tick:lock").catch(() => null);
      const lockHeld = !!lockValue;

      // Queue depths
      const queueDepths = await container.queue.depth().catch(() => []);

      // Last publish from history
      const todayHistory = await container.history.getToday().catch(() => ({ entries: [] }));
      const lastPublished = todayHistory.entries.find((e) => e.telegramMessageId > 0);

      // Provider engine summary
      const engineSummary = container.providerEngine?.getSummary?.() ?? null;

      // Quiet hours check
      const isQuiet = container.quietHoursChecker?.isQuietHours(now, settings.scheduler) ?? false;

      return json({
        ok: true,
        currentTime: {
          epoch: now,
          iso: new Date(now).toISOString(),
          localTime,
          timezone: tz,
          date: today,
        },
        scheduler: {
          enabled: settings.scheduler.enabled,
          botEnabled: settings.general.botEnabled,
          maintenanceMode: settings.general.maintenanceMode,
          approveMode: settings.approveMode ?? false,
          isQuietHours: isQuiet,
          quietHours: settings.scheduler.quietHours,
          postingWindows: settings.scheduler.postingWindows,
          postsPerDay: settings.content.postsPerDay,
        },
        plan: plan ? {
          date: plan.date,
          strategy: plan.strategy,
          generatedAt: plan.generatedAt,
          totalSlots: slots.length,
          completed: completed.length,
          pending: pending.length,
          dueNow: dueNow.length,
          failed: failed.length,
          publishing: publishing.length,
          slots: slots.map((s) => {
            // v12.0.0: Calculate overdue minutes for each slot.
            const schedTime = s.scheduledTime ?? s.time;
            const [sH, sM] = schedTime.split(":").map(Number);
            const schedMin = (sH ?? 0) * 60 + (sM ?? 0);
            const overdueMin = (s.status === "pending") ? Math.max(0, nowMinutes - schedMin) : 0;
            return {
              index: s.index,
              window: `${s.time}-${s.windowEnd ?? s.time}`,
              scheduledTime: schedTime,  // v12.0.0: the REAL publish trigger
              time: s.time,
              windowEnd: s.windowEnd ?? s.time,
              category: s.category,
              status: s.status,
              provider: s.provider,
              error: s.error ?? null,
              overdueMinutes: overdueMin,
            };
          }),
        } : null,
        nextSlot: nextSlot ? (() => {
          // v12.0.0: Calculate remaining minutes until scheduledTime.
          const schedTime = nextSlot.scheduledTime ?? nextSlot.time;
          const [sH, sM] = schedTime.split(":").map(Number);
          const schedMin = (sH ?? 0) * 60 + (sM ?? 0);
          const remainingMin = schedMin - nowMinutes;
          return {
            index: nextSlot.index,
            window: `${nextSlot.time}-${nextSlot.windowEnd ?? nextSlot.time}`,
            time: nextSlot.time,
            windowEnd: nextSlot.windowEnd ?? nextSlot.time,
            scheduledTime: schedTime,  // v12.0.0: the REAL publish trigger
            category: nextSlot.category,
            inMinutes: remainingMin,
            remainingLabel: remainingMin > 0
              ? (remainingMin >= 60 ? `${Math.floor(remainingMin / 60)}h ${remainingMin % 60}m` : `${remainingMin}m`)
              : "due now",
          };
        })() : null,
        dueSlots: dueNow.map((s) => {
          // v12.0.0: Include scheduledTime + overdue in the due-slots list.
          const schedTime = s.scheduledTime ?? s.time;
          const [sH, sM] = schedTime.split(":").map(Number);
          const schedMin = (sH ?? 0) * 60 + (sM ?? 0);
          const overdueMin = nowMinutes - schedMin;
          return {
            index: s.index,
            window: `${s.time}-${s.windowEnd ?? s.time}`,
            scheduledTime: schedTime,
            category: s.category,
            overdueMinutes: Math.max(0, overdueMin),
          };
        }),
        lock: {
          held: lockHeld,
          value: lockValue,
        },
        lastTick: lastTick ? {
          epoch: lastTick,
          iso: new Date(lastTick).toISOString(),
          agoMinutes: Math.round((now - lastTick) / 60000),
        } : null,
        lastPublish: lastPublished ? {
          publishedAt: lastPublished.publishedAt,
          agoMinutes: Math.round((now - lastPublished.publishedAt) / 60000),
          category: lastPublished.category,
        } : null,
        queueDepths,
        providerEngine: engineSummary,
        gracePeriodHours: 4, // v11.2.0
        staleTickThresholdHours: 3, // v11.2.0
        // v12.0.2: Cron Optimization — Quiet Hours Guard status.
        // Computed LIVE from settings + current time (zero KV reads).
        // v12.0.2: Removed lastQuietSkip KV read — quiet hours are zero-KV now.
        cronOptimization: (() => {
          const qh = settings.scheduler.quietHours;
          const isQuiet = container.quietHoursChecker?.isQuietHours(now, settings.scheduler) ?? false;
          return {
            enabled: true,
            quietHoursGuard: true,
            currentState: isQuiet ? "sleeping" : "active",
            reason: isQuiet ? "quiet_hours" : null,
            quietHours: qh ? `${qh.start}-${qh.end}` : null,
            nextActiveTime: qh?.end ?? null,
            localTime: localTime,
            timezone: tz,
            // v12.0.2: Confirm zero-KV during quiet hours.
            kvOpsDuringQuiet: "0 reads / 0 writes",
          };
        })(),
      });
    } catch (error) {
      return json({ ok: false, error: errMsg(error) }, 500);
    }
  }

  // ── Scheduler: force publish ──
  // v11.4.0: CRITICAL FIX — previously called scheduler.tick() which fires ALL
  // due slots (causing double-publish when manual + scheduled overlap).
  // Now generates ONE fresh post and publishes it, WITHOUT touching scheduler.
  if (apiPath === "scheduler/force-publish" && request.method === "POST") {
    try {
      const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
      const lang = settings.language.default;
      const result = await container.content.processForCategory(
        "A", null, lang, { skipEnqueue: true },
      );
      if (result.ok && result.content) {
        const pubResult = await container.finalPublisher.publish(result.content);
        if (pubResult.ok) {
          await container.duplicateDetector.recordPublished(result.content).catch(() => {});
          // v12.1.1: Send the exact same post to admin PM (was missing!)
          const adminId = Number(env.ADMIN_ID ?? "0");
          if (adminId > 0 && container.tg && pubResult.sentText) {
            if (pubResult.sentMediaUrl) {
              await container.tg.sendPhoto(adminId, pubResult.sentMediaUrl, pubResult.sentText, {
                parse_mode: "HTML",
              }).catch(() => {});
            } else {
              // v12.1.1: Add link preview for text-only posts
              const previewMode = settings.telegram.linkPreviewMode ?? "smart";
              const pluginId = result.content.pluginId ?? "";
              const goodPreviewProviders = new Set(["github", "github-trending", "github-releases", "github-events", "devto", "hackernews-algolia", "cloudflare-blog", "huggingface-blog", "producthunt", "openai-news"]);
              const previewOpts = previewMode === "disabled" ? { is_disabled: true }
                : previewMode === "always" ? { is_disabled: false, show_above_text: true }
                : goodPreviewProviders.has(pluginId) ? { is_disabled: false, show_above_text: true }
                : { is_disabled: true };
              await container.tg.sendMessage(adminId, pubResult.sentText, {
                parse_mode: "HTML",
                link_preview_options: previewOpts,
              }).catch(() => {});
            }
            // Send summary report
            await container.tg.sendMessage(adminId, [
              ``,
              `<b>━━━ ⚡ MANUAL PUBLISH ━━━</b>`,
              ``,
              ``,
              `<blockquote>🔌 <b>Source:</b> ${result.content.pluginId}</blockquote>`,
              `<blockquote>📰 <b>Headline:</b> ${result.content.headline ?? "(none)"}</blockquote>`,
              `<blockquote>📤 <b>Channel Msg ID:</b> ${pubResult.telegramMessageId}</blockquote>`,
              `<blockquote>⭐ <b>Quality:</b> ${result.content.quality.overallScore}/100</blockquote>`,
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
          }
          return json({ ok: true, message: "Published (manual, not scheduled)", contentId: result.content.id });
        }
        return json({ ok: false, error: pubResult.error ?? "Publish failed" }, 500);
      }
      return json({ ok: false, error: result.error ?? "No content available" }, 500);
    } catch (error) {
      return json({ ok: false, error: errMsg(error) }, 500);
    }
  }

  // ── Scheduler: pause/resume ──
  if (apiPath === "scheduler/pause" && request.method === "POST") {
    const adminId = Number(env.ADMIN_ID ?? "0");
    const cur = await container.config.getSettings(adminId);
    const newVal = false;
    await container.config.updateSettings(adminId, { scheduler: { ...cur.scheduler, enabled: newVal } });
    return json({ ok: true, enabled: newVal, message: "Scheduler paused" });
  }
  if (apiPath === "scheduler/resume" && request.method === "POST") {
    const adminId = Number(env.ADMIN_ID ?? "0");
    const cur = await container.config.getSettings(adminId);
    const newVal = true;
    await container.config.updateSettings(adminId, { scheduler: { ...cur.scheduler, enabled: newVal } });
    return json({ ok: true, enabled: newVal, message: "Scheduler resumed" });
  }

  // ── Settings: update runtime config ──
  if (apiPath === "settings" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const adminId = Number(env.ADMIN_ID ?? "0");
    const result = await container.config.updateSettings(adminId, body);
    return json(result);
  }

  // ── Clear actions ──
  if (apiPath === "clear/logs" && request.method === "POST") { await container.debug.clearLogs(); return json({ ok: true }); }
  if (apiPath === "clear/dedup" && request.method === "POST") { await container.duplicateDetector.clear(); return json({ ok: true }); }
  if (apiPath === "clear/queue" && request.method === "POST") { await container.queue.clearAll(); return json({ ok: true }); }

  // ── Toggle bot enabled ──
  if (apiPath === "toggle/bot" && request.method === "POST") {
    const adminId = Number(env.ADMIN_ID ?? "0");
    const cur = await container.config.getSettings(adminId);
    const newVal = !cur.general.botEnabled;
    await container.config.updateSettings(adminId, { general: { ...cur.general, botEnabled: newVal } });
    return json({ ok: true, botEnabled: newVal });
  }

  // ── Toggle approve mode ──
  if (apiPath === "toggle/approve" && request.method === "POST") {
    const adminId = Number(env.ADMIN_ID ?? "0");
    const cur = await container.config.getSettings(adminId);
    const newVal = !cur.approveMode;
    await container.config.updateSettings(adminId, { approveMode: newVal });
    return json({ ok: true, approveMode: newVal });
  }

  // ── Clear config cache (forces reload from KV) ──
  if (apiPath === "clear/cache" && request.method === "POST") {
    container.config.clearCache?.();
    return json({ ok: true, message: "Config cache cleared" });
  }

  // ── Reset settings to defaults ──
  if (apiPath === "reset/settings" && request.method === "POST") {
    const defaults = await container.config.resetSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    return json({ ok: !!defaults, settings: defaults });
  }

  // ── Clear source caches (forces re-fetch from APIs) ──
  if (apiPath === "clear/sources" && request.method === "POST") {
    const prefixes = ["fredy:source:"];
    let deleted = 0;
    for (const prefix of prefixes) {
      const list = await env.Fredy_SETTINGS.list({ prefix }).catch(() => ({ keys: [] as { name: string }[] }));
      for (const key of list.keys) {
        await env.Fredy_SETTINGS.delete(key.name).catch(() => {});
        deleted++;
      }
    }
    return json({ ok: true, deleted });
  }

  // ── Post to Channel: send a specific plugin's content to the channel ──
  if (apiPath === "post/channel" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { pluginId?: string };
    const pluginId = body.pluginId;
    if (!pluginId) {
      return json({ ok: false, error: "Missing pluginId" }, 400);
    }

    // Load settings early — needed for language and throughout.
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);

    const report: Record<string, unknown> = {
      pluginId,
      timestamp: new Date().toISOString(),
      stages: {} as Record<string, unknown>,
    };
    const stages = report["stages"] as Record<string, unknown>;
    const lang = settings?.language?.default ?? "auto";

    // Stage 1: Clear source cache for this plugin so we get fresh items.
    try {
      const cacheKey = `fredy:source:${pluginId}:cache`;
      await env.Fredy_SETTINGS.delete(cacheKey).catch(() => {});
    } catch { /* ignore */ }

    // Stage 2: Fetch from plugin
    try {
      const t0 = Date.now();
      const items = await container.plugins.fetchFrom(pluginId);
      stages["fetch"] = {
        ok: true,
        durationMs: Date.now() - t0,
        itemCount: items.length,
        items: items.slice(0, 3).map(i => ({
          id: i.id,
          title: i.title,
          url: i.url,
          hasBody: !!i.body,
          hasImage: !!i.imageUrl,
        })),
      };
      if (items.length === 0) {
        stages["fetch"] = { ...stages["fetch"] as object, error: "No items returned" };
        report["ok"] = false;
        report["error"] = "Plugin returned no items";
        return json(report);
      }

      // Stage 3: Try items in random order until one succeeds.
      let result = null;
      const attempts = [];
      // Shuffle items to get variety.
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      // Track the FIRST duplicate we encounter so we can route it to
      // admin PM. We keep trying subsequent items because the user
      // asked for a fresh post — only if EVERY item is a duplicate
      // (or otherwise rejected) do we fall back to the duplicate flow.
      let firstDuplicate: { itemId: string; existingId: string; reason: string; item: typeof items[number] } | null = null;
      for (let idx = 0; idx < Math.min(shuffled.length, 5); idx++) {
        const item = shuffled[idx]!;
        const t1 = Date.now();
        // NOTE: skipDedup is now FALSE — dedup is always checked.
        // This is the fix for the "manual re-post creates a duplicate
        // in the channel" bug. When a duplicate is detected, the result
        // carries `duplicateOf` and the loop continues to try other
        // items. If all items are duplicates, the caller routes the
        // first one to admin PM with a "duplicate" label instead of
        // publishing to the channel.
        const r = await container.content.process(item, lang, { skipDedup: false });
        attempts.push({
          itemIndex: idx,
          itemId: item.id,
          ok: r.ok,
          stage: r.stage,
          error: r.error,
          isDuplicate: !!r.duplicateOf,
          duplicateOf: r.duplicateOf ?? undefined,
          durationMs: Date.now() - t1,
        });
        if (r.ok && r.content) {
          result = r;
          break;
        }
        // Capture first duplicate for fallback admin-PM routing.
        if (!firstDuplicate && r.duplicateOf) {
          firstDuplicate = {
            itemId: item.id,
            existingId: r.duplicateOf.contentId,
            reason: r.duplicateOf.reason,
            item,
          };
        }
      }

      stages["process"] = {
        ok: !!result,
        attempts,
        totalAttempts: attempts.length,
        contentId: result?.content?.id,
        error: result ? undefined : (attempts[attempts.length - 1]?.error ?? "All items rejected"),
      };

      // ── Duplicate fallback: send to admin PM with a "duplicate" label ──
      // v9.0.2: Only send duplicate formatted post if ALL items were genuine duplicates.
      // If some failed due to KV quota, don't send the duplicate formatted post.
      const allDupsForFallback = attempts.length > 0 && attempts.every(a => a.isDuplicate);
      if (!result && firstDuplicate && allDupsForFallback) {
        const adminId = Number(env.ADMIN_ID ?? "0");
        const dupItem = firstDuplicate.item;
        report["ok"] = false;
        report["duplicate"] = true;
        report["error"] = `All ${attempts.length} items were duplicates of previously-published content`;
        report["duplicateOf"] = firstDuplicate;

        if (adminId > 0) {
          // 1. Build a ReadyContent-like object from the source item so we
          //    can run it through uxLayer.transform() and get the EXACT
          //    same formatted post that would have gone to the channel.
          try {
            // Process with skipDedup=true so it goes all the way through
            // the AI pipeline (we already know it's a duplicate — we want
            // the formatted output now).
            const dupProcessed = await container.content.process(dupItem, lang, { skipDedup: true, skipEnqueue: true });
            if (dupProcessed.ok && dupProcessed.content) {
              const finalPost = await container.uxLayer.transform(dupProcessed.content);
              // Send the formatted post (photo or text) — prefixed with a
              // "DUPLICATE — for manual forwarding" notice.
              if (finalPost.media && finalPost.media.type === "image" && finalPost.media.url) {
                await container.tg.sendPhoto(adminId, finalPost.media.url, finalPost.caption, {
                  parse_mode: "HTML",
                }).catch(() => {});
              } else {
                await container.tg.sendMessage(adminId, finalPost.fullText, {
                  parse_mode: "HTML",
                }).catch(() => {});
              }
            }
          } catch { /* transform failed — fall through to notice */ }

          // 2. Send the duplicate notice (with item info + match reason).
          try {
            const previewLines = [
              ``,
              `<b>━━━ 🔁 DUPLICATE DETECTED ━━━</b>`,
              ``,
              ``,
              `<blockquote>🔌 <b>Source:</b> ${pluginId}</blockquote>`,
              `<blockquote>📰 <b>Item:</b> ${escapeHtml(dupItem.title?.slice(0, 200) ?? "(no title)")}</blockquote>`,
              `<blockquote>🔗 <b>URL:</b> ${escapeHtml(dupItem.url ?? "(no url)")}</blockquote>`,
              `<blockquote>⚠️ <b>Matches existing:</b> <code>${escapeHtml(firstDuplicate.existingId)}</code> (${firstDuplicate.reason})</blockquote>`,
              ``,
              `<blockquote>💡 <i>The formatted post above was sent here for manual forwarding. Forward it to the channel if you want it published anyway.</i></blockquote>`,
            ].join("\n");
            await container.tg.sendMessage(adminId, previewLines, { parse_mode: "HTML" }).catch(() => {});
          } catch { /* skip */ }
        }

        return json(report);
      }

      if (!result || !result.content) {
        report["ok"] = false;

        // v9.0.2: Fix false "duplicate" report.
        // Check if ALL items were duplicates, or if some failed for other reasons (KV quota, etc.).
        const allDuplicates = attempts.length > 0 && attempts.every(a => a.isDuplicate);
        const hasKvError = attempts.some(a => a.error?.includes("KV put() limit") || a.error?.includes("quota"));

        if (allDuplicates && firstDuplicate) {
          // All items were genuinely duplicates.
          report["duplicate"] = true;
          report["error"] = `All ${attempts.length} items were duplicates of previously-published content`;
          report["duplicateOf"] = firstDuplicate;
        } else if (hasKvError) {
          // Some items failed due to KV quota.
          report["error"] = `Processing failed: KV daily write limit exceeded. ${attempts.filter(a => a.isDuplicate).length} duplicates, ${attempts.filter(a => !a.isDuplicate).length} KV errors.`;

          // Notify admin about KV quota.
          const adminId = Number(env.ADMIN_ID ?? "0");
          if (adminId > 0) {
            await container.tg.sendMessage(adminId, [
              ``,
              `<b>━━━ ⚠️ KV QUOTA EXCEEDED ━━━</b>`,
              ``,
              ``,
              `<blockquote>❌ <b>Error:</b> KV daily write limit exceeded</blockquote>`,
              `<blockquote>📅 <b>Time:</b> ${new Date().toISOString()}</blockquote>`,
              `<blockquote>🔌 <b>Plugin:</b> ${pluginId}</blockquote>`,
              `<blockquote>💡 <b>Action:</b> Publishing will resume after midnight UTC reset.</blockquote>`,
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
          }
        } else if (firstDuplicate) {
          // Mixed: some duplicates, some other errors.
          report["duplicate"] = true;
          report["error"] = `Processing failed: ${attempts.filter(a => a.isDuplicate).length} duplicates, ${attempts.filter(a => !a.isDuplicate).length} other errors`;
          report["duplicateOf"] = firstDuplicate;
        } else {
          report["error"] = `All ${attempts.length} items were rejected (quality or processing failed)`;
        }

        return json(report);
      }

      // Stage 3: Publish to channel
      const t2 = Date.now();
      const pubResult = await container.finalPublisher.publish(result.content);
      // v9.3.1: Record in dedup store ONLY after successful publish.
      if (pubResult.ok) {
        await container.duplicateDetector.recordPublished(result.content).catch(() => {});
      }
      stages["publish"] = {
        ok: pubResult.ok,
        durationMs: Date.now() - t2,
        messageId: pubResult.telegramMessageId,
        chatId: pubResult.telegramChatId,
        error: pubResult.error,
      };

      // Send the actual post to admin PM + notification with API details.
      // On SUCCESS: send the formatted post + success notification.
      // On FAILURE (e.g., quality reject): send the RAW post + failure notice
      //   so the admin can see what was rejected and forward it manually
      //   if they want it published anyway.
      const adminId = Number(env.ADMIN_ID ?? "0");
      if (adminId > 0) {
        if (pubResult.ok) {
          // v12.1.1: Send the EXACT same post that went to the channel (not a re-transform).
          if (pubResult.sentText) {
            if (pubResult.sentMediaUrl) {
              await container.tg.sendPhoto(adminId, pubResult.sentMediaUrl, pubResult.sentText, {
                parse_mode: "HTML",
              }).catch(() => {});
            } else {
              // v12.1.1: Add link preview for text-only posts
              const previewMode = settings?.telegram?.linkPreviewMode ?? "smart";
              const pluginId2 = result.content.pluginId ?? "";
              const goodPrev = new Set(["github","github-trending","github-releases","github-events","devto","hackernews-algolia","cloudflare-blog","huggingface-blog","producthunt","openai-news"]);
              const prevOpts = previewMode === "disabled" ? { is_disabled: true }
                : previewMode === "always" ? { is_disabled: false, show_above_text: true }
                : goodPrev.has(pluginId2) ? { is_disabled: false, show_above_text: true }
                : { is_disabled: true };
              await container.tg.sendMessage(adminId, pubResult.sentText, {
                parse_mode: "HTML",
                link_preview_options: prevOpts,
              }).catch(() => {});
            }
          }
          await container.tg.sendMessage(adminId, [
            ``,
            reportBanner("📤", `MANUAL PUBLISH — ${pluginId}`),
            ``,
            ``,
            reportRow("🏷️", "Category", result.content.category),
            reportRow("🔌", "Source Plugin", result.content.pluginId),
            reportRow("🤖", "AI Model", `${result.content.aiProvider}/${result.content.aiModel}`),
            qualityRow(result.content.quality.overallScore),
            reportRow("📊", "Tokens Used", String(result.content.tokensUsed)),
            reportRow("📤", "Channel Message ID", String(pubResult.telegramMessageId)),
            reportRow("🔖", "Content ID", result.content.id),
            reportRow("🔗", "Source URL", result.content.sourceUrl ?? "(none)"),
            reportRow("📰", "Headline", result.content.headline ?? "(none)"),
          ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        } else {
          // ── FAILURE: send the raw post + failure notice ──
          // The post was rejected (e.g., quality score < threshold, or
          // publish validation failed). Send the formatted post to the
          // admin PM anyway so they can see what was rejected and decide
          // whether to forward it to the channel manually.
          try {
            const finalPost = await container.uxLayer.transform(result.content);
            const notice = `⚠️ <b>Post REJECTED (not published to channel)</b>\n<b>Reason:</b> ${pubResult.error ?? "unknown"}\n\n<i>Formatted post below — forward to channel manually if you want it published:</i>\n\n`;
            if (finalPost.media && finalPost.media.type === "image" && finalPost.media.url) {
              // Send photo with the notice prepended to caption.
              await container.tg.sendPhoto(adminId, finalPost.media.url, `${notice}${finalPost.caption ?? ""}`, {
                parse_mode: "HTML",
              }).catch(() => {});
            } else {
              await container.tg.sendMessage(adminId, `${notice}${finalPost.fullText}`, {
                parse_mode: "HTML",
              }).catch(() => {});
            }
          } catch { /* non-fatal */
            // If even the transform fails, send a plain-text fallback.
            await container.tg.sendMessage(adminId, [
              ``,
              reportBanner("❌", "POST REJECTED"),
              ``,
              ``,
              reportRow("🔌", "Plugin", pluginId),
              reportRow("⚠️", "Reason", pubResult.error ?? "unknown"),
              reportRow("📰", "Headline", result.content.headline ?? "(none)"),
              reportRow("🔗", "Source URL", result.content.sourceUrl ?? "(none)"),
              qualityRow(result.content.quality.overallScore),
              reportRow("🤖", "AI Model", `${result.content.aiProvider}/${result.content.aiModel}`),
              ``,
              `<blockquote>💡 <i>Could not format the post for forwarding. Check the API response for details.</i></blockquote>`,
            ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
          }
          // Send a short failure summary.
          await container.tg.sendMessage(adminId, [
            ``,
            reportBanner("❌", "PUBLISH FAILED"),
            ``,
            ``,
            reportRow("🔌", "Plugin", pluginId),
            qualityRow(result.content.quality.overallScore),
            reportRow("🤖", "AI Model", `${result.content.aiProvider}/${result.content.aiModel}`),
            reportRow("⚠️", "Error", pubResult.error ?? "unknown"),
          ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        }
      }

      report["ok"] = pubResult.ok;
      report["error"] = pubResult.error;
      report["content"] = result.content ? {
        id: result.content.id,
        pluginId: result.content.pluginId,
        category: result.content.category,
        headline: result.content.headline,
        textPreview: result.content.text?.slice(0, 500),
        fullContentText: result.content.text,
        sourceUrl: result.content.sourceUrl,
        language: result.content.language,
        aiProvider: result.content.aiProvider,
        aiModel: result.content.aiModel,
        qualityScore: result.content.quality.overallScore,
        tokensUsed: result.content.tokensUsed,
      } : null;
      // Include AI debug info if AI failed.
      if (result.aiDebug) {
        report["aiDebug"] = result.aiDebug;
      } else if (result.content?.aiProvider === "format-only") {
        report["aiDebug"] = {
          error: "Unknown — aiDebug not set",
          attempts: [],
          usedFallback: true,
          fallbackReason: "format-only provider detected but no debug info",
        };
      }
      // Include publish debug info if publish failed.
      if (!pubResult.ok) {
        report["publishDebug"] = container.finalPublisher._lastPublishDebug;
      }

      return json(report);
    } catch (error) {
      stages["error"] = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.split("\n").slice(0, 5) : undefined,
      };
      report["ok"] = false;
      report["error"] = error instanceof Error ? error.message : String(error);

      // v8.10.0: If KV quota exceeded, notify admin PM.
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes("KV put() limit") || errMsg.includes("quota")) {
        const adminId = Number(env.ADMIN_ID ?? "0");
        if (adminId > 0) {
          await container.tg.sendMessage(adminId, [
            ``,
            `<b>━━━ ⚠️ KV QUOTA EXCEEDED ━━━</b>`,
            ``,
            ``,
            `<blockquote>❌ <b>Error:</b> ${escapeHtml(errMsg)}</blockquote>`,
            `<blockquote>📅 <b>Time:</b> ${new Date().toISOString()}</blockquote>`,
            `<blockquote>💡 <b>Action needed:</b> KV daily write limit (1000) exceeded. Publishing will resume automatically after the limit resets (midnight UTC). Consider upgrading to Cloudflare Workers Paid plan for higher limits.</blockquote>`,
          ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        }
      }

      return json(report, 500);
    }
  }

  // ── Full Checkup: complete system diagnostic JSON ──
  if (apiPath === "checkup" && request.method === "POST") {
    const report: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      version: APP_VERSION,
    };

    // 1. System info
    try {
      const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
      report["system"] = {
        version: APP_VERSION,
        buildDate: APP_BUILD_DATE,
        runtime: "cloudflare-workers",
        kv: !!env.Fredy_SETTINGS,
        cacheStats: container.config.cacheStats(),
        pluginCount: container.plugins.list().length,
        providerCount: container.providers.list().length,
        secrets: {
          botToken: !!env.BOT_TOKEN,
          gemini: !!env.GEMINI_API_KEY,
          openrouter: !!env.OPENROUTER_API_KEY,
          newsapi: !!env.NEWSAPI_KEY,
          nasa: !!env.NASA_API_KEY,
          github: !!env.GITHUB_TOKEN,
          cronKey: !!env.CRON_KEY,
          webhookSecret: !!env.WEBHOOK_SECRET,
          debugToken: !!env.DEBUG_TOKEN,
          adminId: !!env.ADMIN_ID,
        },
      };
      report["settings"] = settings;
    } catch (e) { report["system"] = { error: errMsg(e) }; }

    // 2. KV test
    try {
      const t0 = Date.now();
      await container.kv.set("fredy:_checkup", "ok", 60);
      const val = await container.kv.get("fredy:_checkup");
      await container.kv.delete("fredy:_checkup");
      report["kv"] = { ok: val === "ok", durationMs: Date.now() - t0 };
    } catch (e) { report["kv"] = { ok: false, error: errMsg(e) }; }

    // 3. Telegram
    try {
      const t0 = Date.now();
      const me = await container.tg.getMe();
      report["telegram"] = {
        ok: me.ok,
        durationMs: Date.now() - t0,
        bot: me.ok ? `@${me.result?.username}` : null,
        botId: me.result?.id,
      };
    } catch (e) { report["telegram"] = { ok: false, error: errMsg(e) }; }

    // 4. AI providers
    try {
      const providers = container.providers.listWithStatus();
      report["aiProviders"] = providers;
    } catch (e) { report["aiProviders"] = { error: errMsg(e) }; }

    // 5. All plugins test
    try {
      const plugins = container.plugins.list();
      const pluginResults: Array<{ id: string; name: string; category: string; enabled: boolean; ok: boolean; itemCount: number; error?: string; durationMs: number }> = [];
      for (const p of plugins) {
        const t0 = Date.now();
        try {
          const items = await container.plugins.fetchFrom(p.metadata.id);
          pluginResults.push({
            id: p.metadata.id,
            name: p.metadata.name,
            category: p.metadata.category,
            enabled: container.plugins.isEnabled(p.metadata.id),
            ok: true,
            itemCount: items.length,
            durationMs: Date.now() - t0,
          });
        } catch (error) {
          pluginResults.push({
            id: p.metadata.id,
            name: p.metadata.name,
            category: p.metadata.category,
            enabled: container.plugins.isEnabled(p.metadata.id),
            ok: false,
            itemCount: 0,
            error: errMsg(error),
            durationMs: Date.now() - t0,
          });
        }
      }
      report["plugins"] = {
        total: pluginResults.length,
        ok: pluginResults.filter(r => r.ok).length,
        failed: pluginResults.filter(r => !r.ok).length,
        results: pluginResults,
      };
    } catch (e) { report["plugins"] = { error: errMsg(e) }; }

    // 6. Queue
    try {
      const depths = await container.queue.depth();
      report["queue"] = { depths, total: depths.reduce((s, d) => s + d.depth, 0) };
    } catch (e) { report["queue"] = { error: errMsg(e) }; }

    // 7. Scheduler
    try {
      const status = await container.scheduler.status();
      report["scheduler"] = status;
    } catch (e) { report["scheduler"] = { error: errMsg(e) }; }

    // 8. History
    try {
      const today = await container.history.getToday();
      report["history"] = { entriesToday: today.entries.length, date: today.date };
    } catch (e) { report["history"] = { error: errMsg(e) }; }

    // 9. Logs
    try {
      const updates = await container.debug.getRecentUpdates().catch(() => []);
      const errors = await container.debug.getRecentErrors().catch(() => []);
      report["logs"] = {
        recentUpdates: updates.length,
        recentErrors: errors.length,
        lastErrors: errors.slice(0, 5),
      };
    } catch (e) { report["logs"] = { error: errMsg(e) }; }

    // Compute overall health
    const sections = ["system", "kv", "telegram", "plugins", "queue", "scheduler", "history"];
    const healthySections = sections.filter(s => {
      const section = report[s] as { ok?: boolean; error?: string } | undefined;
      return section && section.ok !== false && !section.error;
    });
    report["overallHealth"] = {
      healthy: healthySections.length,
      total: sections.length,
      percentage: Math.round((healthySections.length / sections.length) * 100),
    };

    return json(report);
  }

  return new Response("Not Found", { status: 404 });
}

function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function json(obj: unknown, status = 200): Response { return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json" } }); }

function managerHTML(env: Env): string {
  const token = env.DEBUG_TOKEN ?? "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fredy Manager</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>">
<style>
:root{--bg:#0a0a0f;--surface:#12121a;--surface2:#1a1a26;--border:#252535;--text:#e0e0ea;--text2:#8888a0;--accent:#6366f1;--accent2:#818cf8;--green:#22c55e;--red:#ef4444;--yellow:#eab308;--blue:#3b82f6;--radius:10px;--sidebar-w:220px}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);font-size:14px;overflow:hidden}
.sidebar{position:fixed;left:0;top:0;bottom:0;width:var(--sidebar-w);background:var(--surface);border-right:1px solid var(--border);z-index:100;transition:transform .3s;overflow-y:auto}
.sidebar.collapsed{transform:translateX(calc(-1*var(--sidebar-w)))}
.sidebar-header{padding:20px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
.sidebar-header h1{font-size:16px;font-weight:700;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;color:var(--text2);transition:all .15s;font-size:13px;margin:2px 8px}
.nav-item:hover{background:var(--surface2);color:var(--text)}.nav-item.active{background:var(--accent);color:#fff}
.nav-icon{font-size:16px;width:20px;text-align:center}
.main{margin-left:var(--sidebar-w);height:100vh;overflow-y:auto;transition:margin-left .3s}.main.expanded{margin-left:0}
.topbar{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;gap:12px;z-index:50}
.topbar button{background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;cursor:pointer;font-size:13px}
.topbar h2{font-size:16px;font-weight:600}
.content{padding:24px;max-width:1200px;margin:0 auto}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:12px}
.card-label{color:var(--text2);font-size:11px;text-transform:uppercase;margin-bottom:4px}.card-value{font-size:18px;font-weight:600}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:8px;color:var(--text2);border-bottom:1px solid var(--border);font-weight:600;font-size:11px;text-transform:uppercase}td{padding:8px;border-bottom:1px solid var(--border)}tr:hover td{background:var(--surface2)}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}.badge-green{background:rgba(34,197,94,.15);color:var(--green)}.badge-red{background:rgba(239,68,68,.15);color:var(--red)}.badge-yellow{background:rgba(234,179,8,.15);color:var(--yellow)}.badge-blue{background:rgba(59,130,246,.15);color:var(--blue)}.badge-gray{background:rgba(136,136,160,.15);color:var(--text2)}
.btn{background:var(--accent);color:#fff;border:none;padding:7px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500}.btn:hover{background:var(--accent2)}.btn-sm{padding:4px 10px;font-size:12px}.btn-danger{background:var(--red)}.btn-ghost{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
.toast{position:fixed;bottom:20px;right:20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 20px;z-index:1000;animation:slideUp .3s;box-shadow:0 4px 20px rgba(0,0,0,.3)}@keyframes slideUp{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}
.page{display:none}.page.active{display:block}
pre{background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:12px;overflow-x:auto;font-size:12px;max-height:400px;overflow-y:auto;font-family:'SF Mono',Monaco,monospace;position:relative}
.copy-btn{position:absolute;top:8px;right:8px;background:var(--surface);border:1px solid var(--border);color:var(--text2);padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px}.copy-btn:hover{color:var(--text)}
.skeleton{background:var(--surface2);border-radius:6px;animation:pulse 1.5s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.progress{background:var(--surface2);border-radius:6px;height:8px;overflow:hidden}.progress-bar{background:var(--accent);height:100%;transition:width .3s}
.test-result{padding:8px 12px;border-radius:6px;margin:4px 0;display:flex;align-items:center;gap:8px;font-size:13px}.test-pass{background:rgba(34,197,94,.1)}.test-fail{background:rgba(239,68,68,.1)}
.post-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;cursor:pointer;transition:border-color .2s}.post-card:hover{border-color:var(--accent)}
@media(max-width:768px){:root{--sidebar-w:200px}.sidebar{transform:translateX(calc(-1*var(--sidebar-w)))}.sidebar.open{transform:translateX(0)}.main{margin-left:0}.resp-2col{grid-template-columns:1fr!important}}
.hero{background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(129,140,248,.04) 60%,rgba(34,197,94,.04));border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:16px;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;top:-40px;right:-40px;width:160px;height:160px;background:radial-gradient(circle,rgba(99,102,241,.15),transparent 70%);pointer-events:none}
.hero-row{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;position:relative}
.live-clock{font-family:'SF Mono',Monaco,monospace;font-size:28px;font-weight:700;color:var(--accent2);letter-spacing:1px;text-shadow:0 0 20px rgba(129,140,248,.3)}
.live-clock .tz{font-size:12px;color:var(--text2);font-weight:400;margin-left:8px}
.health-gauge{position:relative;width:72px;height:72px;flex-shrink:0}
.health-gauge svg{transform:rotate(-90deg)}
.health-gauge .gauge-bg{fill:none;stroke:var(--surface2);stroke-width:6}
.health-gauge .gauge-fg{fill:none;stroke:var(--accent);stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset .8s ease}
.health-gauge .gauge-label{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}
.health-gauge .gauge-val{font-size:18px;font-weight:700}
.health-gauge .gauge-sub{font-size:9px;color:var(--text2);text-transform:uppercase}
.countdown-box{text-align:center;padding:12px 20px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.3);border-radius:10px;min-width:140px}
.countdown-box .cd-val{font-size:26px;font-weight:700;color:var(--accent2);font-family:'SF Mono',Monaco,monospace}
.countdown-box .cd-label{font-size:10px;color:var(--text2);text-transform:uppercase;margin-top:2px}
.countdown-box .cd-sched{font-size:11px;color:var(--accent);margin-top:4px;font-weight:600}
.stat-pod{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;transition:all .2s;position:relative;overflow:hidden}
.stat-pod:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 4px 16px rgba(99,102,241,.15)}
.stat-pod .sp-icon{position:absolute;top:10px;right:10px;font-size:20px;opacity:.25}
.stat-pod .sp-label{font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.stat-pod .sp-val{font-size:22px;font-weight:700}
.stat-pod .sp-sub{font-size:11px;color:var(--text2);margin-top:2px}
.activity-feed{max-height:320px;overflow-y:auto}
.activity-item{display:flex;align-items:center;gap:10px;padding:10px 8px;border-bottom:1px solid var(--border);transition:background .15s}
.activity-item:last-child{border-bottom:none}
.activity-item:hover{background:var(--surface2)}
.activity-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.activity-dot.cat-a{background:var(--accent)}.activity-dot.cat-b{background:var(--blue)}.activity-dot.cat-c{background:var(--green)}
.activity-body{flex:1;min-width:0}
.activity-preview{font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.activity-meta{font-size:10px;color:var(--text2);margin-top:2px;display:flex;gap:8px}
.activity-ago{font-size:11px;color:var(--text2);white-space:nowrap;flex-shrink:0}
.quiet-pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.quiet-pill.sleeping{background:rgba(59,130,246,.15);color:var(--blue)}
.quiet-pill.active{background:rgba(34,197,94,.15);color:var(--green)}
.divider-label{display:flex;align-items:center;gap:8px;color:var(--text2);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:16px 0 8px}
.divider-label::after{content:"";flex:1;height:1px;background:var(--border)}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.fade-in{animation:fadeIn .3s ease}
.heatmap{display:grid;grid-template-columns:auto repeat(24,1fr);gap:2px;font-size:10px}
.heatmap-label{color:var(--text2);padding:2px 6px;text-align:right;white-space:nowrap}
.heatmap-cell{aspect-ratio:1;border-radius:3px;min-height:20px;display:flex;align-items:center;justify-content:center;color:var(--text);font-size:9px;font-weight:600;transition:transform .15s;cursor:default}
.heatmap-cell:hover{transform:scale(1.3);z-index:10;box-shadow:0 0 8px rgba(99,102,241,.5)}
.heatmap-cell.empty{background:var(--surface2)}
.heatmap-axis{color:var(--text2);font-size:9px;text-align:center;padding:2px 0}
.donut{position:relative;width:120px;height:120px}
.donut svg{transform:rotate(-90deg)}
.donut-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}
.donut-val{font-size:24px;font-weight:700}
.donut-label{font-size:10px;color:var(--text2);text-transform:uppercase}
.bar-chart{display:flex;flex-direction:column;gap:6px}
.bar-row{display:flex;align-items:center;gap:8px;font-size:12px}
.bar-label{width:120px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
.bar-track{flex:1;height:20px;background:var(--surface2);border-radius:4px;overflow:hidden;position:relative}
.bar-fill{height:100%;border-radius:4px;transition:width .8s ease;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;font-size:11px;font-weight:600;color:#fff;min-width:24px}
.dist-bar{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dist-label{width:80px;font-size:11px;color:var(--text2);flex-shrink:0}
.dist-track{flex:1;height:24px;background:var(--surface2);border-radius:4px;overflow:hidden}
.dist-fill{height:100%;border-radius:4px;transition:width .8s ease;display:flex;align-items:center;padding-left:8px;font-size:11px;font-weight:600;color:#fff}
.sparkline{display:flex;align-items:flex-end;gap:3px;height:50px;padding:4px 0}
.spark-bar{flex:1;background:linear-gradient(180deg,var(--accent2),var(--accent));border-radius:3px 3px 0 0;min-height:3px;transition:height .5s;position:relative}
.spark-bar:hover{filter:brightness(1.3)}
.spark-bar .spark-tip{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);padding:3px 6px;border-radius:4px;font-size:10px;white-space:nowrap;opacity:0;transition:opacity .15s;pointer-events:none;margin-bottom:4px;z-index:10}
.spark-bar:hover .spark-tip{opacity:1}
</style></head><body>
<div class="sidebar" id="sidebar"><div class="sidebar-header"><span style="font-size:20px">🤖</span><h1>Fredy</h1></div><div class="sidebar-nav" id="nav"></div></div>
<div class="main" id="main"><div class="topbar"><button onclick="toggleSidebar()">☰</button><h2 id="page-title">Dashboard</h2><div style="margin-left:auto;display:flex;gap:8px"><button onclick="refresh()" class="btn btn-ghost btn-sm">🔄 Refresh</button></div></div><div class="content" id="content"></div></div>
<script>
const TOKEN="${token}";const API="/Manager/api/";
const navItems=[{id:"dashboard",icon:"📊",label:"Dashboard"},{id:"strategy",icon:"🎯",label:"Strategy"},{id:"post",icon:"📤",label:"Post to Channel"},{id:"backtest",icon:"🧪",label:"Back-Test"},{id:"plugins",icon:"🔌",label:"Plugins"},{id:"queue",icon:"📥",label:"Queue"},{id:"ai",icon:"🤖",label:"AI"},{id:"scheduler",icon:"📅",label:"Scheduler"},{id:"schedulerdebug",icon:"🔬",label:"Scheduler Debug"},{id:"statistics",icon:"📈",label:"Statistics"},{id:"logs",icon:"📜",label:"Logs"},{id:"debug",icon:"🐞",label:"Debug"},{id:"config",icon:"⚙️",label:"Configuration"},{id:"settings",icon:"🔧",label:"Settings"},{id:"system",icon:"🖥️",label:"System"},{id:"about",icon:"ℹ️",label:"About"}];
let currentPage="dashboard";
function buildNav(){document.getElementById("nav").innerHTML=navItems.map(i=>'<div class="nav-item" onclick="navigate('+ "'" +i.id+ "'" +')" id="nav-'+i.id+'"><span class="nav-icon">'+i.icon+'</span>'+i.label+'</div>').join("");}
function navigate(id){currentPage=id;document.querySelectorAll(".nav-item").forEach(e=>e.classList.remove("active"));const el=document.getElementById("nav-"+id);if(el)el.classList.add("active");const item=navItems.find(i=>i.id===id);document.getElementById("page-title").textContent=item?item.label:"";loadPage(id);}
function toggleSidebar(){document.getElementById("sidebar").classList.toggle("open");}
async function api(path,method="GET",body=null){const opts={method,headers:{}};if(TOKEN)opts.headers["Authorization"]="Bearer "+TOKEN;if(body){opts.headers["Content-Type"]="application/json";opts.body=JSON.stringify(body);}const r=await fetch(API+path,opts);return r.json();}
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),3000);}
function badge(val){return val?'<span class="badge badge-green">ON</span>':'<span class="badge badge-gray">OFF</span>';}
function fmtTime(ts){if(!ts)return"—";const d=new Date(typeof ts==="number"?ts:parseInt(ts));return d.toLocaleTimeString()+" "+d.toLocaleDateString();}
function fmtAgo(ts){if(!ts)return"—";const s=Math.floor((Date.now()-(typeof ts==="number"?ts:parseInt(ts)))/1000);if(s<60)return s+"s ago";if(s<3600)return Math.floor(s/60)+"m ago";return Math.floor(s/3600)+"h ago";}
function card(l,v){return '<div class="card"><div class="card-label">'+l+'</div><div class="card-value">'+v+"</div></div>"}
function copyText(text){navigator.clipboard.writeText(text).then(()=>toast("📋 Copied!")).catch(()=>toast("❌ Copy failed"));}
function copyElement(id){const el=document.getElementById(id);if(el)copyText(el.textContent);}
function preWithCopy(id,content){return '<pre id="'+id+'">'+content+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement('+ "'" +id+ "'" +')" style="margin-top:4px">📋 Copy</button>';}
function loadPage(id){const c=document.getElementById("content");c.innerHTML='<div class="card">Loading…</div>';if(window._dashInterval){clearInterval(window._dashInterval);window._dashInterval=null;}({dashboard:loadDashboard,strategy:loadStrategy,post:loadPost,backtest:loadBacktest,plugins:loadPlugins,queue:loadQueue,ai:loadAI,scheduler:loadScheduler,schedulerdebug:loadSchedulerDebug,statistics:loadStats,logs:loadLogs,debug:loadDebug,config:loadConfig,settings:loadSettings,system:loadSystem,about:loadAbout}[id]||(()=>c.innerHTML='<div class="card">Page not found.</div>'))();}

async function loadDashboard(){
  const c=document.getElementById("content");
  c.innerHTML='<div class="card">Loading dashboard…</div>';
  const d=await api("dashboard/overview");
  if(!d.ok){c.innerHTML='<div class="card">Error: '+(d.error||"unknown")+'</div>';return;}

  const botOn=d.bot?.enabled;
  const apprOn=d.approveMode;
  const schedOn=d.scheduler?.enabled;
  const qh=d.quietHours;
  const isQuiet=qh?.active;
  const np=d.nextPost;

  // Health score: 4 checks (bot, scheduler, secrets, plugins)
  let healthScore=0,healthMax=4;
  if(botOn)healthScore++;
  if(schedOn)healthScore++;
  if(d.hasSecrets?.botToken&&d.hasSecrets?.gemini)healthScore++;
  if(d.plugins?.enabled>0)healthScore++;
  const healthPct=Math.round((healthScore/healthMax)*100);
  const healthColor=healthPct>=75?'var(--green)':healthPct>=50?'var(--yellow)':'var(--red)';
  // SVG gauge: circumference = 2*pi*r = 2*pi*30 = 188.5
  const circ=188.5;const dashOffset=circ-(circ*healthPct/100);

  // Stat pods
  const statPod=(icon,label,val,sub)=>'<div class="stat-pod"><span class="sp-icon">'+icon+'</span><div class="sp-label">'+label+'</div><div class="sp-val">'+val+'</div><div class="sp-sub">'+(sub||"")+'</div></div>';

  let html='<div class="fade-in">';

  // ── HERO SECTION ──
  html+='<div class="hero">'+
    '<div class="hero-row">'+
      '<div>'+
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">'+
          '<span style="font-size:24px">🤖</span>'+
          '<span style="font-size:18px;font-weight:700">Fredy</span>'+
          '<span class="badge badge-blue">v'+d.version+'</span>'+
          (isQuiet?'<span class="quiet-pill sleeping">😴 Sleeping</span>':'<span class="quiet-pill active">✅ Active</span>')+
        '</div>'+
        '<div class="live-clock" id="live-clock">'+escapeHtml(d.currentTime?.localTime||"—")+'<span class="tz">'+escapeHtml(d.currentTime?.timezone||"")+'</span></div>'+
        '<div style="font-size:12px;color:var(--text2);margin-top:4px">'+escapeHtml(d.currentTime?.date||"")+' · '+(d.lastTick?fmtAgo(d.lastTick)+" since last tick":"no tick yet")+'</div>'+
      '</div>'+
      '<div class="health-gauge">'+
        '<svg width="72" height="72">'+
          '<circle class="gauge-bg" cx="36" cy="36" r="30"></circle>'+
          '<circle class="gauge-fg" cx="36" cy="36" r="30" stroke="'+healthColor+'" stroke-dasharray="'+circ+'" stroke-dashoffset="'+dashOffset+'"></circle>'+
        '</svg>'+
        '<div class="gauge-label"><div class="gauge-val" style="color:'+healthColor+'">'+healthPct+'%</div><div class="gauge-sub">Health</div></div>'+
      '</div>'+
    '</div>'+
    (np? '<div style="margin-top:14px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">'+
        '<div class="countdown-box">'+
          '<div class="cd-val" id="countdown-val">'+escapeHtml(np.remainingLabel||"—")+'</div>'+
          '<div class="cd-label">Next Publish In</div>'+
          '<div class="cd-sched">🎯 '+escapeHtml(np.scheduledTime)+' · '+escapeHtml(np.window)+'</div>'+
        '</div>'+
        '<div style="flex:1;min-width:180px">'+
          '<div style="font-size:11px;color:var(--text2);text-transform:uppercase;margin-bottom:4px">Upcoming Post</div>'+
          '<div style="font-size:14px;font-weight:600">Slot #'+np.index+' · Category '+escapeHtml(String(np.category))+'</div>'+
          '<div style="font-size:12px;color:var(--text2);margin-top:2px">Provider: <code>'+(np.provider||"auto")+'</code></div>'+
          '<div style="font-size:11px;color:var(--text2);margin-top:4px">The 20-min watcher fires on the first tick at or after '+escapeHtml(np.scheduledTime)+'.</div>'+
        '</div>'+
    '</div>':'<div style="margin-top:14px;padding:14px;background:var(--surface2);border-radius:10px;color:var(--text2);font-size:13px">No pending posts today. The 24h maintenance cron will generate tomorrows plan at midnight UTC.</div>')+
  '</div>';

  // ── QUICK CONTROLS ──
  html+='<div class="card"><h3 style="margin-bottom:8px">🎛️ Quick Controls</h3><div style="display:flex;gap:8px;flex-wrap:wrap">'+
    '<button class="btn '+(botOn?'btn-danger':'')+'" onclick="toggleBot()">'+(botOn?'🔴 Stop Bot':'🟢 Start Bot')+'</button>'+
    '<button class="btn '+(apprOn?'btn-danger':'')+'" onclick="toggleApprove()">'+(apprOn?'🔓 Approve: OFF':'🔐 Approve: ON')+'</button>'+
    '<button class="btn btn-ghost" onclick="refresh()">🔄 Refresh</button>'+
    '<button class="btn btn-ghost" onclick="testEverything()">🧪 Test Everything</button>'+
  '</div></div>';

  // ── STAT PODS (hoverable) ──
  html+='<div class="divider-label">System Overview</div>';
  html+='<div class="card-grid">'+
    statPod('🤖','Bot',botOn?'ON':'OFF',botOn?'running':'stopped')+
    statPod('📅','Scheduler',schedOn?'ON':'OFF',schedOn?'active':'paused')+
    statPod('🔐','Approve',apprOn?'ON':'OFF',apprOn?'manual review':'auto')+
    statPod('🤖','AI',escapeHtml(d.aiProvider||"—"),'primary')+
    statPod('🌐','Language',escapeHtml(d.language||"—"),'default')+
    statPod('🔌','Plugins',d.plugins?.enabled+'/'+d.plugins?.total,'enabled/total')+
    statPod('📤','Posts Today',d.scheduler?.postsToday??0,'published')+
    statPod('🌙','Quiet Hours',isQuiet?'Sleeping':'Active',qh?.config?qh.config.start+'-'+qh.config.end:'—')+
  '</div>';

  // ── RECENT ACTIVITY FEED ──
  html+='<div class="card"><h3 style="margin-bottom:8px">📜 Recent Activity</h3>';
  if(d.recentPublishes&&d.recentPublishes.length>0){
    html+='<div class="activity-feed">';
    for(const p of d.recentPublishes){
      const catClass='cat-'+String(p.category).toLowerCase();
      const ago=p.agoMinutes<60?p.agoMinutes+'m ago':Math.floor(p.agoMinutes/60)+'h ago';
      html+='<div class="activity-item">'+
        '<div class="activity-dot '+catClass+'"></div>'+
        '<div class="activity-body">'+
          '<div class="activity-preview">'+escapeHtml(p.textPreview||"(no preview)")+'</div>'+
          '<div class="activity-meta"><span>📂 '+escapeHtml(String(p.category))+'</span><span>🔌 '+escapeHtml(p.pluginId||"?")+'</span><span>⭐ '+p.qualityScore+'</span></div>'+
        '</div>'+
        '<div class="activity-ago">'+ago+'</div>'+
      '</div>';
    }
    html+='</div>';
  } else {
    html+='<p style="color:var(--text2);padding:12px">No recent publishes yet. Once the scheduler fires, the last 5 posts will appear here.</p>';
  }
  html+='</div>';

  // ── GLOBAL STATS ──
  html+='<div class="card"><h3 style="margin-bottom:8px">📊 Global Stats</h3><div class="card-grid">'+
    card("Processed",d.stats?.processed??0)+
    card("Published",'<span style="color:var(--green)">'+(d.stats?.published??0)+'</span>')+
    card("Rejected",'<span style="color:var(--yellow)">'+(d.stats?.rejected??0)+'</span>')+
    card("Failed",'<span style="color:var(--red)">'+(d.stats?.failed??0)+'</span>')+
  '</div></div>';

  // ── SECRETS ──
  html+='<div class="card"><h3 style="margin-bottom:8px">🔑 Secrets</h3>'+Object.entries(d.hasSecrets||{}).map(([k,v])=>'<span class="badge '+(v?"badge-green":"badge-red")+'" style="margin:2px">'+k+": "+(v?"✓":"✗")+"</span>").join(" ")+'</div>';

  // ── QUIET HOURS NOTE ──
  if(isQuiet){
    html+='<div class="card" style="border:1px solid var(--blue);background:rgba(59,130,246,.05)"><h3 style="margin-bottom:4px">🌙 Quiet Hours Active</h3><p style="color:var(--text2);font-size:12px">Layer 1 (Scheduler Watcher) is sleeping with <b>zero KV operations</b>. Normal publishing resumes at <b>'+escapeHtml(qh?.nextActiveTime||"07:30")+'</b>. Manual force-publish still works.</p></div>';
  }

  html+='</div>';
  c.innerHTML=html;

  // Start live clock + countdown updater
  if(window._dashInterval)clearInterval(window._dashInterval);
  window._dashInterval=setInterval(()=>{
    const clk=document.getElementById("live-clock");
    if(clk&&d.currentTime){
      // Compute current time in the configured timezone
      try{
        const fmt=new Intl.DateTimeFormat("en-US",{timeZone:d.currentTime.timezone,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
        clk.innerHTML=escapeHtml(fmt.format(new Date()))+'<span class="tz">'+escapeHtml(d.currentTime.timezone)+'</span>';
      }catch(e){/* keep static */}
    }
    // Update countdown
    if(d.nextPost){
      const cd=document.getElementById("countdown-val");
      if(cd){
        // Recompute remaining minutes from the original scheduledTime
        const [sH,sM]=(d.nextPost.scheduledTime||"").split(":").map(Number);
        const schedMin=(sH||0)*60+(sM||0);
        const nowFmt=new Intl.DateTimeFormat("en-US",{timeZone:d.currentTime.timezone,hour:"2-digit",minute:"2-digit",hour12:false});
        const [nH,nM]=nowFmt.format(new Date()).split(":").map(Number);
        const nowMin=(nH||0)*60+(nM||0);
        let rem=schedMin-nowMin;
        if(rem<0)rem=0;
        cd.textContent=rem>0?(rem>=60?Math.floor(rem/60)+"h "+(rem%60)+"m":rem+"m"):"due now";
      }
    }
  },1000);
}
async function toggleBot(){const d=await api("toggle/bot","POST");toast(d.ok?(d.botEnabled?"🟢 Bot ON":"🔴 Bot OFF"):"❌ Failed");loadDashboard();}
async function toggleApprove(){const d=await api("toggle/approve","POST");toast(d.ok?(d.approveMode?"🔐 Approve ON":"🔓 Approve OFF"):"❌ Failed");loadDashboard();}

async function testEverything(){
  const w=document.getElementById("everything-result");
  w.innerHTML='<div class="card">⏳ Running comprehensive tests... (this can take 30-60s)</div>';
  try{
    const d=await api("test/everything","POST");
    const jsonStr=JSON.stringify(d,null,2);
    const summary=d.summary||"unknown";
    const ok=d.overallOk;
    // Build section-by-section summary
    const secRows=Object.entries(d.sections||{}).map(([k,v])=>{
      const ok2=v&&v.ok;
      const detail=v?(v.detail||v.error||""):"";
      const ms=v&&v.durationMs!==undefined?v.durationMs+"ms":"";
      return '<tr><td><code>'+k+'</code></td><td>'+(ok2?'<span class="badge badge-green">OK</span>':'<span class="badge badge-red">FAIL</span>')+'</td><td style="color:var(--text2)">'+(typeof detail==="string"?detail:JSON.stringify(detail))+'</td><td style="color:var(--text2);font-size:11px">'+ms+'</td></tr>';
    }).join("");
    // Build plugin sub-table if present
    let pluginDetail="";
    if(d.sections&&d.sections.plugins&&d.sections.plugins.results){
      pluginDetail='<div style="margin-top:12px"><h4 style="margin-bottom:6px">🔌 Plugin Details</h4><table style="font-size:12px"><thead><tr><th>Plugin</th><th>Status</th><th>Items</th><th>Time</th><th>Error</th></tr></thead><tbody>'+
      d.sections.plugins.results.map(r=>'<tr><td><code>'+r.id+'</code></td><td>'+(r.ok?'<span class="badge badge-green">OK</span>':'<span class="badge badge-red">FAIL</span>')+'</td><td>'+r.itemCount+'</td><td>'+r.durationMs+'ms</td><td style="color:var(--red);font-size:11px">'+(r.error||"")+'</td></tr>').join("")+
      '</tbody></table></div>';
    }
    w.innerHTML='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">'+(ok?'✅ All Tests Passed':'❌ Some Tests Failed')+'</h3><span class="badge '+(ok?"badge-green":"badge-red")+'">'+summary+'</span></div>'+
    '<table style="font-size:13px"><thead><tr><th>Section</th><th>Status</th><th>Detail</th><th>Time</th></tr></thead><tbody>'+secRows+'</tbody></table>'+
    pluginDetail+
    '<div style="margin-top:12px"><h4 style="margin-bottom:6px">📋 Full JSON Report (copyable)</h4><pre id="everything-pre" style="max-height:500px">'+escapeHtml(jsonStr)+'</pre><button class="btn btn-sm" onclick="copyElement('+ "'" +'everything-pre'+ "'" +')">📋 Copy Full Report</button></div></div>';
    toast(ok?"✅ All tests passed!":"❌ Some tests failed");
  }catch(e){
    w.innerHTML='<div class="card">❌ Test failed: '+escapeHtml(String(e))+'</div>';
    toast("❌ Test failed");
  }
}

function escapeHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

async function loadPost(){
  const d=await api("plugins");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error loading plugins</div>';return;}
  const enabledPlugins=d.plugins.filter(p=>p.enabled);
  // v12.0.11: Group by tier — includes Tier V (scheduled content)
  const tierS=enabledPlugins.filter(p=>p.tier==="S");
  const tierA=enabledPlugins.filter(p=>p.tier==="A");
  const tierB=enabledPlugins.filter(p=>p.tier==="B");
  const tierV=enabledPlugins.filter(p=>p.tier==="V");

  function pluginCard(p){
    const tierColor=p.tier==="S"?"var(--accent)":p.tier==="A"?"var(--blue)":p.tier==="V"?"#a855f7":"var(--text2)";
    const tierEmoji=p.tier==="S"?"🥇":p.tier==="A"?"🥈":p.tier==="V"?"🟣":"🥉";
    return '<div class="post-card" data-tier-color="'+tierColor+'" onclick="postToChannel('+ "'" +p.id+ "'" +')">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
        '<span style="font-weight:600;font-size:13px">'+tierEmoji+' '+p.name+'</span>'+
        '<span class="badge" style="background:'+tierColor+'20;color:'+tierColor+';font-size:9px">'+p.tier+'</span>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--text2);display:flex;gap:8px">'+
        '<span>Cat '+p.category+'</span>'+
        (p.lastItemCount!==null&&p.lastItemCount!==undefined?'<span>'+p.lastItemCount+' items</span>':'')+
      '</div>'+
    '</div>';
  }

  let html='<div class="card" style="border:1px solid var(--accent);background:linear-gradient(135deg,rgba(99,102,241,.1),rgba(129,140,248,.05))">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<h3 style="margin:0">📤 Post to Channel</h3>'+
      '<button class="btn btn-ghost btn-sm" onclick="loadPost()">🔄 Refresh</button>'+
    '</div>'+
    '<p style="color:var(--text2);margin-bottom:0;font-size:13px">Select a provider to fetch, process with AI, and publish immediately. Tries up to 5 items per provider.</p>'+
  '</div>';

  if(tierS.length>0){
    html+='<div class="card"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:16px">🥇</span><h4 style="margin:0;color:var(--accent)">Tier S — Core ('+tierS.length+')</h4></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">'+tierS.map(pluginCard).join("")+'</div></div>';
  }
  if(tierA.length>0){
    html+='<div class="card"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:16px">🥈</span><h4 style="margin:0;color:var(--blue)">Tier A — Important ('+tierA.length+')</h4></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">'+tierA.map(pluginCard).join("")+'</div></div>';
  }
  if(tierB.length>0){
    html+='<div class="card"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:16px">🥉</span><h4 style="margin:0;color:var(--text2)">Tier B — Supporting ('+tierB.length+')</h4></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">'+tierB.map(pluginCard).join("")+'</div></div>';
  }
  if(tierV.length>0){
    html+='<div class="card"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:16px">🟣</span><h4 style="margin:0;color:#a855f7">Tier V — Scheduled ('+tierV.length+')</h4></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">'+tierV.map(pluginCard).join("")+'</div></div>';
  }

  html+='<div id="post-result"></div>';
  c.innerHTML=html;
}

async function postToChannel(pluginId){
  const w=document.getElementById("post-result");
  w.innerHTML='<div class="card" style="border:1px solid var(--accent)"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:20px;animation:spin 1s linear infinite">⏳</span><div><div style="font-weight:600">Publishing from '+pluginId+'</div><div style="color:var(--text2);font-size:12px">Fetching → AI processing → Publishing to channel...</div></div></div></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
  toast("📤 Posting from "+pluginId+"...");
  try{
    const d=await api("post/channel","POST",{pluginId});
    const jsonStr=JSON.stringify(d,null,2);
    const ok=d.ok;

    let stageHtml="";
    if(d.stages){
      const st=d.stages;
      if(st.fetch)stageHtml+='<div class="test-result '+(st.fetch.ok?'test-pass':'test-fail')+'"><span>'+(st.fetch.ok?'✅':'❌')+'</span><span style="font-weight:600">Fetch</span><span style="color:var(--text2);flex:1">'+(st.fetch.ok?st.fetch.itemCount+' items':st.fetch.error||'failed')+'</span><span style="color:var(--text2);font-size:11px">'+st.fetch.durationMs+'ms</span></div>';
      if(st.process){
        const procMs=st.process.attempts?(st.process.attempts.reduce(function(s,a){return s+(a.durationMs||0)},0)):'?';
        stageHtml+='<div class="test-result '+(st.process.ok?'test-pass':'test-fail')+'"><span>'+(st.process.ok?'✅':'❌')+'</span><span style="font-weight:600">Process</span><span style="color:var(--text2);flex:1">'+(st.process.ok?'OK ('+st.process.totalAttempts+' tried)':st.process.error||'failed')+'</span><span style="color:var(--text2);font-size:11px">'+procMs+'ms</span></div>';
      }
      if(st.publish)stageHtml+='<div class="test-result '+(st.publish.ok?'test-pass':'test-fail')+'"><span>'+(st.publish.ok?'✅':'❌')+'</span><span style="font-weight:600">Publish</span><span style="color:var(--text2);flex:1">'+(st.publish.ok?'Msg #'+st.publish.messageId:st.publish.error||'failed')+'</span><span style="color:var(--text2);font-size:11px">'+st.publish.durationMs+'ms</span></div>';
    }
    let contentHtml="";
    if(d.content){
      contentHtml='<div class="card" style="margin-top:8px;border-left:3px solid '+(d.content.qualityScore>=80?'var(--green)':d.content.qualityScore>=60?'var(--yellow)':'var(--red)')+'"><h4 style="margin-bottom:6px">📝 Content Published</h4>'+
        '<div style="font-size:12px;color:var(--text2);margin-bottom:8px;display:flex;flex-wrap:wrap;gap:6px">'+
          '<span class="badge badge-gray">🔌 '+d.content.pluginId+'</span>'+
          '<span class="badge badge-gray">🏷️ '+d.content.category+'</span>'+
          '<span class="badge badge-gray">🤖 '+d.content.aiProvider+'/'+d.content.aiModel+'</span>'+
          '<span class="badge '+(d.content.qualityScore>=80?'badge-green':d.content.qualityScore>=60?'badge-yellow':'badge-red')+'">'+d.content.qualityScore+'/100</span>'+
          '<span class="badge badge-gray">📊 '+d.content.tokensUsed+' tokens</span>'+
        '</div>'+
        '<div style="background:var(--surface2);padding:12px;border-radius:6px;font-size:13px;max-height:300px;overflow-y:auto;line-height:1.6">'+escapeHtml(d.content.textPreview||'')+'</div>'+
        (d.content.sourceUrl?'<div style="margin-top:6px;font-size:11px;color:var(--text2)"><b>Source:</b> <a href="'+d.content.sourceUrl+'" target="_blank" style="color:var(--accent)">'+d.content.sourceUrl+'</a></div>':'')+
      '</div>';
    }
    w.innerHTML='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">'+(ok?'✅ Posted Successfully':'❌ Post Failed')+'</h3><span class="badge '+(ok?'badge-green':'badge-red')+'">'+pluginId+'</span></div>'+
      stageHtml+contentHtml+
      '<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--text2)">📋 Full JSON Report</summary><pre id="post-json" style="max-height:500px;margin-top:8px">'+escapeHtml(jsonStr)+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement('+ "'" +'post-json'+ "'" +')" style="margin-top:4px">📋 Copy Report</button></details></div>';
    toast(ok?"✅ Posted to channel!":"❌ Post failed");
  }catch(e){
    w.innerHTML='<div class="card" style="border:1px solid var(--red)">❌ Error: '+escapeHtml(String(e))+'</div>';
    toast("❌ Error");
  }
}

async function loadBacktest(){
  const c=document.getElementById("content");
  c.innerHTML='<div class="card"><h3 style="margin-bottom:8px">🧪 Full System Back-Test</h3><p style="color:var(--text2);margin-bottom:12px">Runs all system tests: KV, Config, Telegram, AI, Plugins, Queue, Scheduler, History, Secrets.</p><button class="btn" onclick="runBacktest()">▶️ Run Back-Test</button></div>'+
  '<div class="card" style="margin-top:12px;border:1px solid var(--accent)"><h3 style="margin-bottom:8px">🏥 Full Checkup (Complete System JSON)</h3><p style="color:var(--text2);margin-bottom:12px">Generates a comprehensive JSON report covering ALL aspects of the bot: system info, KV, Telegram, AI providers, all plugins, queue, scheduler, history, logs, and overall health score. Perfect for debugging — just copy and send!</p><button class="btn" onclick="runCheckup()">▶️ Run Full Checkup</button></div>'+
  '<div id="backtest-results"></div><div id="checkup-results"></div>';
}
async function runBacktest(){
  const r=document.getElementById("backtest-results");r.innerHTML='<div class="card">Running tests…</div>';
  const d=await api("backtest","POST");
  r.innerHTML='<div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><h3>'+(d.ok?'✅ All Tests Passed':'❌ Some Tests Failed')+'</h3><span class="badge '+(d.ok?"badge-green":"badge-red")+'">'+d.summary+'</span></div></div>'+
  d.results.map(t=>'<div class="test-result '+(t.ok?"test-pass":"test-fail")+'"><span>'+(t.ok?"✅":"❌")+'</span><span style="font-weight:600">'+t.test+'</span><span style="color:var(--text2);flex:1">'+t.detail+'</span><span style="color:var(--text2);font-size:11px">'+t.durationMs+'ms</span><button class="btn btn-sm btn-ghost" onclick="copyText('+ "'" +t.test+": "+t.detail+ "'" +')">📋</button></div>').join("");
  toast(d.ok?"✅ All tests passed!":"❌ Some tests failed");
}
async function runCheckup(){
  const r=document.getElementById("checkup-results");r.innerHTML='<div class="card">⏳ Running full system checkup... (this can take 30-60s)</div>';
  toast("🏥 Running full checkup...");
  try{
    const d=await api("checkup","POST");
    const jsonStr=JSON.stringify(d,null,2);
    const health=d.overallHealth||{healthy:0,total:0,percentage:0};
    const pct=health.percentage;
    const color=pct>=80?'badge-green':(pct>=50?'badge-yellow':'badge-red');
    r.innerHTML='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">🏥 Full System Checkup</h3><span class="badge '+color+'">'+health.healthy+'/'+health.total+' ('+pct+'%)</span></div>'+
    '<div class="progress" style="margin-bottom:12px"><div class="progress-bar" style="width:'+pct+'%;background:'+(pct>=80?'var(--green)':(pct>=50?'var(--yellow)':'var(--red'))+'"></div></div>'+
    '<table style="font-size:12px;margin-bottom:12px"><tbody>'+
    '<tr><td><b>System</b></td><td>'+escapeHtml(JSON.stringify(d.system||{}))+'</td></tr>'+
    '<tr><td><b>KV</b></td><td>'+escapeHtml(JSON.stringify(d.kv||{}))+'</td></tr>'+
    '<tr><td><b>Telegram</b></td><td>'+escapeHtml(JSON.stringify(d.telegram||{}))+'</td></tr>'+
    '<tr><td><b>AI Providers</b></td><td>'+escapeHtml(JSON.stringify(d.aiProviders||{}))+'</td></tr>'+
    '<tr><td><b>Plugins</b></td><td>'+(d.plugins?d.plugins.ok+'/'+d.plugins.total+' OK':'?')+'</td></tr>'+
    '<tr><td><b>Queue</b></td><td>'+escapeHtml(JSON.stringify(d.queue||{}))+'</td></tr>'+
    '<tr><td><b>Scheduler</b></td><td>'+escapeHtml(JSON.stringify(d.scheduler||{}).slice(0,200))+'</td></tr>'+
    '<tr><td><b>History</b></td><td>'+escapeHtml(JSON.stringify(d.history||{}))+'</td></tr>'+
    '<tr><td><b>Logs</b></td><td>'+(d.logs?d.logs.recentUpdates+' updates, '+d.logs.recentErrors+' errors':'?')+'</td></tr>'+
    '</tbody></table>'+
    '<h4 style="margin-bottom:6px">📋 Complete JSON Report (copy and send for debugging)</h4>'+
    '<pre id="checkup-json" style="max-height:600px">'+escapeHtml(jsonStr)+'</pre>'+
    '<button class="btn" onclick="copyElement('+ "'" +'checkup-json'+ "'" +')">📋 Copy Full JSON Report</button></div>';
    toast(pct>=80?"✅ System healthy!":(pct>=50?"⚠️ Some issues":"❌ Critical issues"));
  }catch(e){
    r.innerHTML='<div class="card">❌ Checkup failed: '+escapeHtml(String(e))+'</div>';
    toast("❌ Checkup failed");
  }
}

async function loadPlugins(){
  const c=document.getElementById("content");
  c.innerHTML='<div class="card">Loading plugins…</div>';
  try{
    const d=await api("plugins");
    if(!d.ok||!d.plugins){c.innerHTML='<div class="card">Error: '+(d.error||"Unknown")+'</div>';return;}
    c.innerHTML='<div style="margin-bottom:12px;display:flex;gap:8px"><button class="btn" onclick="testAllPlugins()">🧪 Test All Plugins</button></div>'+
    '<table><thead><tr><th>ID</th><th>Name</th><th>Cat</th><th>Enabled</th><th>Priority</th><th>Rate Limit</th><th>Actions</th></tr></thead><tbody>'+
    d.plugins.map(p=>'<tr><td><code>'+p.id+'</code></td><td>'+p.name+'</td><td>'+p.category+'</td><td>'+badge(p.enabled)+'</td><td>'+p.priority+'</td><td>'+p.rateLimit+'/hr</td><td><button class="btn btn-sm" onclick="testPlugin('+ "'" +p.id+ "'" +')">Test</button> <button class="btn btn-sm '+(p.enabled?'btn-danger':'')+'" onclick="togglePlugin('+ "'" +p.id+ "'" +')">'+(p.enabled?'Disable':'Enable')+'</button></td></tr>').join("")+'</tbody></table>'+
    '<div id="test-all-results"></div>';
  }catch(e){c.innerHTML='<div class="card">Failed to load plugins: '+e+'</div>';}
}

async function testAllPlugins(){
  const r=document.getElementById("test-all-results");r.innerHTML='<div class="card">Testing all plugins…</div>';
  const d=await api("test/all-plugins","POST");
  r.innerHTML='<div class="card"><h3 style="margin-bottom:8px">Test All Results</h3>'+
  d.results.map(t=>'<div class="test-result '+(t.ok?"test-pass":"test-fail")+'"><span>'+(t.ok?"✅":"❌")+'</span><span style="font-weight:600">'+t.id+'</span><span style="color:var(--text2);flex:1">'+(t.ok?t.itemCount+" items":t.error)+'</span><button class="btn btn-sm btn-ghost" onclick="copyText('+ "'" +t.id+": "+(t.ok?t.itemCount+" items":t.error)+ "'" +')">📋</button></div>').join("")+'</div>';
  toast("Test all complete");
}

async function testPlugin(id){toast("Testing "+id+"...");const d=await api("test/plugin/"+id,"POST");toast(d.ok?"✅ "+id+": "+d.itemCount+" items":"❌ "+id+": "+d.error);}
async function togglePlugin(id){const d=await api("plugin/"+id+"/toggle","POST");toast(d.ok?(d.enabled?"✅ "+id+" enabled":"🔴 "+id+" disabled"):"❌ Failed");loadPlugins();}

async function loadQueue(){
  const c=document.getElementById("content");
  c.innerHTML='<div class="card">Loading queue…</div>';
  try{
    const d=await api("queue");
    if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
    const l=d.limits||{};
    const items=d.items||{};
    const now=d.serverTime||Date.now();
    let html='<div class="card" style="display:flex;justify-content:space-between;align-items:center"><div><h3 style="margin:0">📥 Ready Queue</h3><p style="margin:4px 0 0;color:var(--text2);font-size:12px">Newest items shown first. Items expire after 24h.</p></div><button class="btn btn-ghost" onclick="loadQueue()">🔄 Refresh</button></div>';
    let totalItems=0;
    for(const cat of["A","B","C"]){
      const q=(d.depths||[]).find(x=>x.category===cat)||{depth:0};
      const lim=l[cat]||{min:0,target:0};
      const pct=lim.target>0?Math.min(100,q.depth/lim.target*100):0;
      const catItems=items[cat]||[];
      totalItems+=catItems.length;
      const oldestAge=q.oldestItemAge?fmtAgeMs(q.oldestItemAge):"—";
      html+='<div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:8px;align-items:center"><span class="badge badge-blue">Category '+cat+'</span><span style="font-size:12px;color:var(--text2)">'+q.depth+" / "+lim.target+' (min '+lim.min+') • oldest: '+oldestAge+'</span></div><div class="progress"><div class="progress-bar" style="width:'+pct+'%"></div></div>';
      if(catItems.length>0){
        html+='<table style="margin-top:8px;font-size:12px;width:100%"><thead><tr><th style="text-align:left">Headline</th><th>Provider</th><th>Lang</th><th>Score</th><th>Enqueued</th><th>Age</th><th>AI</th><th>Source</th><th>Actions</th></tr></thead><tbody>';
        html+=catItems.map(function(it){
          const score=it.qualityScore||0;
          const scoreBadge = score>=80?'<span class="badge badge-green">'+score+'</span>':score>=60?'<span class="badge badge-yellow">'+score+'</span>':'<span class="badge badge-red">'+score+'</span>';
          const enqTime=fmtShortTime(it.enqueuedAt,now);
          const age=fmtAgo(it.enqueuedAt);
          const src=it.sourceUrl?'<a href="'+escapeHtml(it.sourceUrl)+'" target="_blank" rel="noopener" style="color:var(--accent)">link'+(it.hasMedia?' 🖼️':'')+'</a>':'—';
          const ai=(it.aiProvider||"—")+"/"+(it.aiModel||"—");
          const headline=escapeHtml(it.headline||"(no headline)");
          const headlineShort=headline.length>80?headline.slice(0,80)+'…':headline;
          return '<tr><td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+headline+'">'+headlineShort+'</td><td>'+escapeHtml(it.pluginId||"")+'</td><td>'+escapeHtml(it.language||"")+'</td><td style="text-align:center">'+scoreBadge+'</td><td style="white-space:nowrap">'+enqTime+'</td><td style="white-space:nowrap;color:var(--text2)">'+age+'</td><td style="white-space:nowrap;font-size:11px">'+escapeHtml(ai)+'</td><td style="text-align:center">'+src+'</td><td style="white-space:nowrap"><button class="btn btn-sm" onclick="sendQueueNow('+ "'" +cat+ "'" +','+ "'" +it.id+ "'" +')">📤 Send</button> <button class="btn btn-sm btn-danger" onclick="deleteQueueItem('+ "'" +cat+ "'" +','+ "'" +it.id+ "'" +')">🗑️</button></td></tr>';
        }).join("");
        html+='</tbody></table>';
      }else{
        html+='<p style="color:var(--text2);margin-top:8px;font-size:12px">No items in queue. Queue will refill on next tick if below minimum.</p>';
      }
      html+='</div>';
    }
    html='<div class="card-grid" style="margin-bottom:12px">'+card("Total Items",totalItems)+card("Categories","A / B / C")+'</div>'+html;
    c.innerHTML=html;
  }catch(e){c.innerHTML='<div class="card">Failed to load queue: '+e+'</div>';}
}
function fmtAgeMs(ms){if(ms==null)return"—";const s=Math.floor(ms/1000);if(s<60)return s+"s";if(s<3600)return Math.floor(s/60)+"m";return Math.floor(s/3600)+"h";}
function fmtShortTime(ts,serverNow){if(!ts)return"—";const d=new Date(typeof ts==="number"?ts:parseInt(ts));const hh=String(d.getHours()).padStart(2,"0");const mm=String(d.getMinutes()).padStart(2,"0");const ss=String(d.getSeconds()).padStart(2,"0");return hh+":"+mm+":"+ss;}
async function deleteQueueItem(cat,id){
  if(!confirm("Delete this item from queue?"))return;
  const d=await api("queue/"+cat+"/delete","POST",{contentId:id});
  toast(d.ok?"🗑️ Item deleted":"❌ Failed");
  loadQueue();
}
async function sendQueueNow(cat,id){
  if(!confirm("Publish this item NOW to channel + admin PM?"))return;
  toast("📤 Publishing...");
  const d=await api("queue/"+cat+"/send-now","POST",{contentId:id});
  toast(d.ok?"✅ Published! Msg: "+d.messageId:"❌ Failed: "+(d.error||""));
  loadQueue();
}

async function loadAI(){
  const d=await api("ai");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  // Build models table with priority and test buttons.
  let modelsHtml='';
  if(d.modelsByProvider){
    for(const[pid,models]of Object.entries(d.modelsByProvider)){
      const provInfo=(d.providers||[]).find(p=>p.id===pid)||{};
      modelsHtml+='<div style="margin-bottom:12px"><h4 style="margin-bottom:6px">'+(provInfo.name||pid)+' '+(provInfo.configured?'✅':'❌')+' '+(provInfo.enabled?'🟢':'🔴')+'</h4><table style="font-size:12px"><thead><tr><th>#</th><th>Model</th><th>Status</th><th>Test</th></tr></thead><tbody>'+
      models.map(m=>'<tr><td style="color:var(--accent);font-weight:600">'+m.priority+'</td><td><code>'+m.model+'</code></td><td>'+(m.enabled?'<span class="badge badge-green">Ready</span>':'<span class="badge badge-gray">Off</span>')+'</td><td><button class="btn btn-sm" onclick="testAIModel('+ "'" +pid+ "'" +','+ "'" +m.model.replace(/'/g,"")+ "'" +')">🧪 Test</button></td></tr>').join('')+
      '</tbody></table></div>';
    }
  }
  c.innerHTML='<div class="card-grid">'+card("Provider",d.settings?.primaryProvider??"—")+card("Fallback",d.settings?.fallbackProvider??"—")+card("Temperature",d.settings?.temperature??"—")+card("Max Tokens",d.settings?.maxTokens??"—")+card("Quality",d.settings?.qualityThreshold??"—")+card("Retries",d.settings?.retryCount??"—")+'</div>'+
  '<div class="card"><h3 style="margin-bottom:8px">🤖 AI Models (by usage priority)</h3><p style="color:var(--text2);font-size:12px;margin-bottom:8px">Priority 1 = tried first, 2 = fallback, etc. Click 🧪 to test each model individually.</p>'+modelsHtml+'</div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Token Usage</h3><div class="card-grid">'+card("Calls",d.tokenStats?.totalCalls??0)+card("Success",d.tokenStats?.successfulCalls??0)+card("Failed",d.tokenStats?.failedCalls??0)+card("Tokens",d.tokenStats?.totalTokens??0)+card("Cost","$"+(d.tokenStats?.totalCost??0).toFixed(4))+'</div></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Test AI (full pipeline)</h3><div style="display:flex;gap:8px;margin-bottom:8px"><input type="text" id="ai-test" placeholder="Test text..." style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px"><button class="btn" onclick="testAI()">Test</button></div><div id="ai-result-wrap"></div></div>';
}

async function testAIModel(pid,model){
  toast("🧪 Testing "+pid+"/"+model+"...");
  const w=document.getElementById("ai-result-wrap");
  if(w)w.innerHTML='<div class="card">Testing '+pid+'/'+model+'...</div>';
  const d=await api("test/ai/"+pid+"/"+model,"POST");
  const jsonStr=JSON.stringify(d,null,2);
  if(w)w.innerHTML='<h4 style="margin:8px 0">Result: '+pid+'/'+model+'</h4><pre id="ai-model-pre">'+escapeHtml(jsonStr)+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement('+ "'" +'ai-model-pre'+ "'" +')">📋 Copy</button>';
  toast(d.ok?"✅ "+model+" OK":"❌ "+model+" failed");
}

async function testAI(){
  const text=document.getElementById("ai-test")?.value||"Test about AI";
  const w=document.getElementById("ai-result-wrap");w.innerHTML='<div class="card">Testing...</div>';
  const d=await api("test/ai","POST",{text});
  const jsonStr=JSON.stringify(d,null,2);
  w.innerHTML='<pre id="ai-pre">'+jsonStr+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement('+ "'" +'ai-pre'+ "'" +')">📋 Copy Result</button>';
  toast(d.ok?"✅ AI OK":"❌ AI failed");
}

async function loadSchedulerDebug(){
  const d=await api("scheduler/debug");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error: '+(d.error||"unknown")+'</div>';return;}
  const t=d.currentTime;
  const s=d.scheduler;
  const p=d.plan;
  const statusBadge=function(st){const m={"published":"badge-green","failed":"badge-red","backup":"badge-yellow","pending":"badge-blue","publishing":"badge-yellow","skipped":"badge-gray","due":"badge-blue"};return '<span class="badge '+(m[st]||"badge-gray")+'">'+st+'</span>';};
  let html='<div class="card" style="border:1px solid var(--accent);background:linear-gradient(135deg,rgba(99,102,241,.1),rgba(129,140,248,.05))"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">🔬 Scheduler Debug (v12.0.2)</h3><button class="btn btn-ghost btn-sm" onclick="loadSchedulerDebug()">🔄 Refresh</button></div><p style="color:var(--text2);margin-top:8px">Three-Layer Cron + EXACT Random Jitter + Zero-KV Quiet Hours. scheduledTime is the EXACT trigger (no tolerance) — the 20-min watcher fires on the first tick at or after it.</p></div>';

  // Current Time section
  html+='<div class="card"><h3 style="margin-bottom:8px">🕐 Current Time</h3><div class="card-grid">'+
    card("UTC ISO",new Date(t.epoch).toISOString().slice(11,19))+
    card("Local Time",t.localTime)+
    card("Timezone",t.timezone)+
    card("Date",t.date)+
    '</div></div>';

  // Scheduler State section
  html+='<div class="card"><h3 style="margin-bottom:8px">⚙️ Scheduler State</h3><div class="card-grid">'+
    card("Scheduler",s.enabled?'<span class="badge badge-green">ON</span>':'<span class="badge badge-red">OFF</span>')+
    card("Bot",s.botEnabled?'<span class="badge badge-green">ON</span>':'<span class="badge badge-red">OFF</span>')+
    card("Maintenance",s.maintenanceMode?'<span class="badge badge-red">ON</span>':'<span class="badge badge-green">OFF</span>')+
    card("Approve Mode",s.approveMode?'<span class="badge badge-yellow">ON</span>':'<span class="badge badge-green">OFF</span>')+
    card("Quiet Hours",s.isQuietHours?'<span class="badge badge-red">ACTIVE</span>':'<span class="badge badge-green">No</span>')+
    card("Posts/Day",s.postsPerDay)+
    '</div>'+
    '<div style="margin-top:8px;color:var(--text2);font-size:13px"><b>Posting Windows:</b> '+(s.postingWindows?s.postingWindows.join(", "):"—")+'</div>'+
    '<div style="color:var(--text2);font-size:13px"><b>Quiet Hours:</b> '+(s.quietHours?s.quietHours.start+"–"+s.quietHours.end:"—")+'</div>'+
    '</div>';

  // Grace & Threshold section
  html+='<div class="card"><h3 style="margin-bottom:8px">⏰ Grace & Thresholds</h3><div class="card-grid">'+
    card("Window Expiry",d.gracePeriodHours+"h")+
    card("Stale Tick Alert",d.staleTickThresholdHours+"h")+
    '</div><div style="margin-top:8px;color:var(--text2);font-size:12px">Window Expiry: slots pending &gt; '+d.gracePeriodHours+'h past window end are marked failed. Stale: admin alert if tick gap &gt; '+d.staleTickThresholdHours+'h.</div></div>';

  // v12.0.0: Three-Layer Cron Architecture
  html+='<div class="card" style="border:1px solid var(--green)"><h3 style="margin-bottom:8px">🏗️ Three-Layer Cron (v12.0.0)</h3><table style="font-size:12px"><thead><tr><th>Layer</th><th>Schedule</th><th>Responsibility</th><th>KV/tick</th></tr></thead><tbody>'+
    '<tr><td><b>1️⃣ Scheduler Watcher</b></td><td>every 20 min</td><td>Check due posts → publish</td><td style="color:var(--green)">1 read, 0 writes*</td></tr>'+
    '<tr><td><b>2️⃣ Provider Refresh</b></td><td>every 2h</td><td>Fetch content, maintain queues</td><td style="color:var(--yellow)">~5 reads, ~3 writes</td></tr>'+
    '<tr><td><b>3️⃣ Daily Maintenance</b></td><td>every 24h</td><td>Generate plan, cleanup KV</td><td style="color:var(--yellow)">~15 reads, ~10 writes</td></tr>'+
    '</tbody></table><div style="margin-top:8px;color:var(--text2);font-size:11px">* 0 writes on the no-due path — the key optimization. Only ~5 publishes/day trigger KV writes.</div></div>';

  // v12.0.1: Quiet Hours Optimization card
  if(d.cronOptimization){
    const co=d.cronOptimization;
    const isSleeping = co.currentState === 'sleeping';
    const stateColor = isSleeping ? 'var(--blue)' : 'var(--green)';
    const stateBg = isSleeping ? 'rgba(59,130,246,.1)' : 'rgba(34,197,94,.1)';
    let qhHtml='<div class="card" style="border:1px solid '+stateColor+';background:'+stateBg+'"><h3 style="margin-bottom:8px">🌙 Quiet Hours Optimization (v12.0.2 — Zero-KV)</h3><div class="card-grid">'+
      card("Status", isSleeping ? '<span class="badge badge-blue">SLEEPING 😴</span>' : '<span class="badge badge-green">ACTIVE ✅</span>')+
      card("Guard", co.quietHoursGuard?'<span class="badge badge-green">ON</span>':'<span class="badge badge-gray">OFF</span>')+
      card("Current Time", (co.localTime||'—')+' <span style="color:var(--text2);font-size:11px">'+(co.timezone||'')+'</span>')+
      card("Quiet Hours", co.quietHours||'—')+
      card("Action", isSleeping ? '<span style="color:var(--blue);font-weight:bold">Skipped without KV</span>' : '<span style="color:var(--green);font-weight:bold">Running</span>')+
      card("Next Active Time", co.nextActiveTime||'—')+
      card("Cron", 'Every 20 min')+
      card("KV Operations", isSleeping ? '<span style="color:var(--green);font-weight:bold">0 reads / 0 writes ✅</span>' : 'Normal')+
      '</div>';
    qhHtml+='<div style="margin-top:6px;color:var(--text2);font-size:11px">💡 v12.0.2: During quiet hours, Layer 1 consumes ZERO KV operations — no reads, no writes, no skip marker. Status is computed live from settings + current time. Manual force-publish bypasses this guard.</div></div>';
    html+=qhHtml;
  }

  // Plan Summary section
  if(p){
    html+='<div class="card"><h3 style="margin-bottom:8px">📋 Daily Plan</h3><div class="card-grid">'+
      card("Date",p.date)+
      card("Strategy",p.strategy)+
      card("Total Slots",p.totalSlots)+
      card("Completed",'<span style="color:var(--green)">'+p.completed+'</span>')+
      card("Pending",'<span style="color:var(--blue)">'+p.pending+'</span>')+
      card("Due NOW",p.dueNow>0?'<span style="color:var(--red);font-weight:bold">'+p.dueNow+'</span>':p.dueNow)+
      card("Publishing",p.publishing>0?'<span style="color:var(--yellow)">'+p.publishing+'</span>':p.publishing)+
      card("Failed",'<span style="color:var(--red)">'+p.failed+'</span>')+
      '</div></div>';
  }

  // Next Slot (v12.0.0: shows scheduledTime + remaining countdown)
  if(d.nextSlot){
    const ns=d.nextSlot;
    const remainingColor = ns.inMinutes <= 0 ? 'var(--red)' : (ns.inMinutes <= 20 ? 'var(--yellow)' : 'var(--green)');
    html+='<div class="card" style="border:1px solid var(--accent)"><h3 style="margin-bottom:8px">⏭️ Next Post</h3><div class="card-grid">'+
      card("Window",ns.window)+
      card("🎯 Scheduled",'<span style="color:var(--accent);font-weight:bold;font-size:16px">'+(ns.scheduledTime||ns.time)+'</span>')+
      card("Category",ns.category)+
      card("⏳ Remaining",'<span style="color:'+remainingColor+';font-weight:bold">'+(ns.remainingLabel||'—')+'</span>')+
      '</div><div style="margin-top:8px;color:var(--text2);font-size:12px">The 20-min watcher will publish this on the first tick at or after <b>'+(ns.scheduledTime||ns.time)+'</b>. Expected delay: 0–20 min.</div></div>';
  } else {
    html+='<div class="card"><h3 style="margin-bottom:8px">⏭️ Next Post</h3><p style="color:var(--text2)">No pending slots remaining today. The 24h maintenance cron will generate tomorrows plan at midnight UTC.</p></div>';
  }

  // Due Slots (CRITICAL — these should fire on next 20-min tick)
  if(d.dueSlots&&d.dueSlots.length>0){
    html+='<div class="card" style="border:1px solid var(--red)"><h3 style="margin-bottom:8px;color:var(--red)">⚠️ Due Now (will fire on next 20-min watcher tick)</h3><table><thead><tr><th>#</th><th>Window</th><th>Scheduled</th><th>Overdue</th><th>Category</th></tr></thead><tbody>';
    for(const sl of d.dueSlots){
      html+='<tr><td>#'+sl.index+'</td><td>'+sl.window+'</td><td style="color:var(--accent);font-weight:bold">'+(sl.scheduledTime||'—')+'</td><td style="color:'+(sl.overdueMinutes>20?'var(--red)':'var(--yellow)')+';font-weight:bold">'+sl.overdueMinutes+'min</td><td>'+sl.category+'</td></tr>';
    }
    html+='</tbody></table></div>';
  }

  // Lock & Tick
  html+='<div class="card"><h3 style="margin-bottom:8px">🔒 Lock & Tick</h3><div class="card-grid">'+
    card("Lock",d.lock.held?'<span class="badge badge-red">HELD</span>':'<span class="badge badge-green">Free</span>')+
    card("Last Tick",d.lastTick?d.lastTick.agoMinutes+"min ago":"—")+
    card("Last Publish",d.lastPublish?d.lastPublish.agoMinutes+"min ago":"—")+
    '</div></div>';

  // Full Slot Table — v12.0.0: Window | Scheduled | Status columns
  if(p&&p.slots){
    html+='<div class="card"><h3 style="margin-bottom:8px">📅 Daily Plan — Window / Scheduled / Status</h3><table style="font-size:12px"><thead><tr><th>#</th><th>Window</th><th>🎯 Scheduled</th><th>Cat</th><th>Status</th><th>Overdue</th><th>Provider</th><th>Error</th></tr></thead><tbody>';
    for(const sl of p.slots){
      const od=sl.overdueMinutes>0?'<span style="color:'+(sl.overdueMinutes>20?'var(--red)':'var(--yellow)')+'">'+sl.overdueMinutes+'m</span>':'—';
      const schedHighlight = sl.status==='pending' ? 'style="color:var(--accent);font-weight:bold"' : '';
      html+='<tr><td>#'+sl.index+'</td><td>'+sl.window+'</td><td '+schedHighlight+'>'+(sl.scheduledTime||sl.time)+'</td><td>'+sl.category+'</td><td>'+statusBadge(sl.status)+'</td><td>'+od+'</td><td>'+(sl.provider||"—")+'</td><td style="color:var(--red);font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis">'+(sl.error||"")+'</td></tr>';
    }
    html+='</tbody></table><div style="margin-top:8px;color:var(--text2);font-size:11px">🎯 <b>Scheduled</b> = the random time within each window. The 20-min watcher fires on the first tick at or after this time. Different every day = human-like jitter.</div></div>';
  }

  // Queue depths
  if(d.queueDepths){
    html+='<div class="card"><h3 style="margin-bottom:8px">📥 Queue Depths</h3><div class="card-grid">'+
      d.queueDepths.map(function(q){return card("Cat "+q.category,q.depth+" items");}).join("")+
      '</div></div>';
  }

  // Provider Engine summary
  if(d.providerEngine){
    const e=d.providerEngine;
    html+='<div class="card"><h3 style="margin-bottom:8px">🔌 Provider Engine</h3><div class="card-grid">'+
      card("Total Providers",e.totalProviders)+
      card("Enabled",e.enabledProviders)+
      card("Healthy",e.healthyProviders)+
      card("Due for Refresh",e.dueForRefresh)+
      card("Est. API/day",e.estimatedDailyApiUsage)+
      '</div>'+
      '<div style="margin-top:8px;color:var(--text2);font-size:13px"><b>Top:</b> '+(e.topPerforming||"—")+' | <b>Worst:</b> '+(e.worstPerforming||"—")+'</div>'+
      '</div>';
  }

  c.innerHTML=html;
}

async function loadScheduler(){
  const d=await api("scheduler");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  const s=d.settings||{};const st=d.status||{};
  window._lastSchedStatus=st;
  // v12.1.2: Also fetch strategy plan for Tier V entries + daily plan.
  let stratData=null;
  try{stratData=await api("strategy");}catch{}
  const stratPlan=stratData?.plan||null;
  const tierVEntries=stratData?.tierVEntries||[];
  const tierVStatus=stratData?.tierVStatus||{};

  let scheduleHtml='';
  if(stratPlan&&stratPlan.posts&&stratPlan.posts.length>0){
    scheduleHtml='<div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><h3>📅 Daily Plan ('+stratPlan.date+') — v12 Window / Scheduled</h3><div style="display:flex;gap:4px"><button class="btn btn-sm" onclick="regeneratePlan()">🔄 Regenerate</button><button class="btn btn-sm btn-ghost" onclick="loadSchedulerDebug()">🔬 Debug</button></div></div><table style="font-size:12px"><thead><tr><th>#</th><th>Window</th><th>🎯 Scheduled</th><th>Cat</th><th>Provider</th><th>Priority</th><th>Status</th></tr></thead><tbody>'+
    stratPlan.posts.map(p=>{
      const status=p.status||'pending';
      const statusBadge=status==='published'?'<span class="badge badge-green">✅ Published</span>':status==='failed'?'<span class="badge badge-red">❌ Failed</span>':status==='backup'?'<span class="badge badge-blue">🔄 Backup</span>':status==='publishing'?'<span class="badge badge-yellow">🔄 Publishing</span>':status==='skipped'?'<span class="badge badge-gray">⏭️ Skipped</span>':'<span class="badge badge-yellow">⏳ Pending</span>';
      const win=p.time+'-'+(p.windowEnd||p.time);
      const sched=p.scheduledTime||p.time;
      const schedStyle=status==='pending'?' style="color:var(--accent);font-weight:bold"':'';
      return '<tr><td>#'+p.index+'</td><td style="color:var(--text2)">'+win+'</td><td'+schedStyle+'>'+sched+'</td><td>'+p.category+'</td><td>'+(p.provider||"—")+'</td><td style="font-size:11px">'+p.priority+'</td><td>'+statusBadge+'</td></tr>';
    }).join("")+
    '</tbody></table><div style="margin-top:8px;color:var(--text2);font-size:11px">🎯 <b>Scheduled</b> = random time within each window (v12 EXACT trigger). The 20-min watcher fires on the first tick at or after this time.</div>'+(stratPlan.theme?'<p style="margin-top:8px;color:var(--text2)">Theme: '+stratPlan.theme.dayName+' — '+stratPlan.theme.topics.join(", ")+'</p>':'')+'</div>';
  }else if(st.today&&st.today.slots&&st.today.slots.length>0){
    scheduleHtml='<div class="card"><h3 style="margin-bottom:8px">📅 Today Schedule — v12 Window / Scheduled</h3><table style="font-size:12px"><thead><tr><th>#</th><th>Window</th><th>🎯 Scheduled</th><th>Category</th><th>Status</th></tr></thead><tbody>'+
    st.today.slots.map((sl,i)=>{const ss=sl.status||'pending';const badge=ss==='published'?'<span class="badge badge-green">✅ Published</span>':ss==='failed'?'<span class="badge badge-red">❌ Failed</span>':ss==='skipped'?'<span class="badge badge-gray">⏭️ Skipped</span>':'<span class="badge badge-yellow">⏳ Pending</span>';const win=sl.time+'-'+(sl.windowEnd||sl.time);const sched=sl.scheduledTime||sl.time;return '<tr><td>'+i+'</td><td style="color:var(--text2)">'+win+'</td><td style="color:var(--accent);font-weight:bold">'+sched+'</td><td>'+sl.category+'</td><td>'+badge+'</td></tr>';}).join("")+
    '</tbody></table></div>';
  }else{
    scheduleHtml='<div class="card"><p style="color:var(--red)">⚠️ Could not generate today'+ "'" +'s plan. Check scheduler settings.</p></div>';
  }

  // v12.1.2: Tier V Scheduled Content section.
  let tierVHtml='';
  if(tierVEntries&&tierVEntries.length>0){
    tierVHtml='<div class="card" style="border:1px solid #a855f7"><h3 style="margin-bottom:8px;color:#a855f7">🟣 Tier V — Scheduled Content (Fixed Schedule)</h3><p style="color:var(--text2);font-size:12px;margin-bottom:8px">Fixed-schedule posts — no random jitter, no category queue. Publishes at the exact configured time every day.</p><table style="font-size:12px"><thead><tr><th>ID</th><th>⏰ Time</th><th>Provider</th><th>Status</th><th>Description</th></tr></thead><tbody>';
    for(const entry of tierVEntries){
      const status=tierVStatus[entry.id];
      const pubBadge=status&&status.published?'<span class="badge badge-green">✅ Published</span>':'<span class="badge badge-yellow">⏳ Pending</span>';
      tierVHtml+='<tr style="background:rgba(168,85,247,.05)"><td><code>'+escapeHtml(entry.id)+'</code></td><td style="color:#a855f7;font-weight:bold">'+escapeHtml(entry.time)+'</td><td>'+escapeHtml(entry.providerId)+'</td><td>'+(entry.enabled?pubBadge:'<span class="badge badge-red">Disabled</span>')+'</td><td style="color:var(--text2);font-size:11px">'+escapeHtml(entry.description||"")+'</td></tr>';
    }
    tierVHtml+='</tbody></table></div>';
  }
  // Also fetch recent history for post history table
  let historyHtml='';
  try{
    const h=await api("history");
    if(h.ok&&h.recent){
      const recent=h.recent.filter(e=>e.telegramMessageId>0).slice(0,5);
      if(recent.length>0){
        historyHtml='<div class="card"><h3 style="margin-bottom:8px">📜 Last 5 Published Posts</h3><table style="font-size:12px"><thead><tr><th>Time</th><th>Plugin</th><th>Cat</th><th>Score</th><th>Msg ID</th></tr></thead><tbody>'+
        recent.map(e=>'<tr><td>'+new Date(e.publishedAt).toLocaleTimeString()+'</td><td>'+e.pluginId+'</td><td>'+e.category+'</td><td>'+e.qualityScore+'</td><td>'+e.telegramMessageId+'</td></tr>').join("")+
        '</tbody></table></div>';
      }
    }
  }catch{}
  c.innerHTML='<div class="card"><h3 style="margin-bottom:8px">⏯️ Scheduler Controls</h3><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn '+(st.enabled?"btn-danger":"")+'" onclick="toggleScheduler()">'+(st.enabled?"⏸️ Pause Scheduler":"▶️ Resume Scheduler")+'</button><button class="btn" onclick="forcePublish()">⚡ Force Publish</button><button class="btn btn-ghost" onclick="loadSchedulerDebug()">🔬 Scheduler Debug</button></div></div>'+
  '<div class="divider-label">v12 Scheduler Status</div>'+
  '<div class="card-grid">'+
    '<div class="stat-pod"><span class="sp-icon">📅</span><div class="sp-label">Enabled</div><div class="sp-val">'+(st.enabled?'ON':'OFF')+'</div><div class="sp-sub">'+(st.enabled?'active':'paused')+'</div></div>'+
    '<div class="stat-pod"><span class="sp-icon">🎯</span><div class="sp-label">Next Slot</div><div class="sp-val" style="color:var(--accent)">'+(st.nextSlot?.scheduledTime||st.nextSlot?.time||"—")+'</div><div class="sp-sub">'+(st.nextSlot?.time?'window '+st.nextSlot.time:'—')+'</div></div>'+
    '<div class="stat-pod"><span class="sp-icon">📤</span><div class="sp-label">Posts Today</div><div class="sp-val">'+(st.postsPublishedToday??0)+'</div><div class="sp-sub">published</div></div>'+
    '<div class="stat-pod"><span class="sp-icon">📥</span><div class="sp-label">Queue</div><div class="sp-val">'+(st.queueDepth??0)+'</div><div class="sp-sub">ready items</div></div>'+
    '<div class="stat-pod"><span class="sp-icon">🌐</span><div class="sp-label">Timezone</div><div class="sp-val" style="font-size:14px">'+(s.timezone??"—")+'</div><div class="sp-sub">scheduler TZ</div></div>'+
    '<div class="stat-pod"><span class="sp-icon">⏱️</span><div class="sp-label">Min Gap</div><div class="sp-val">'+(s.minGapMinutes??"90")+'min</div><div class="sp-sub">between posts</div></div>'+
    '<div class="stat-pod"><span class="sp-icon">🔒</span><div class="sp-label">Lock Timeout</div><div class="sp-val">'+(s.lockTimeoutSec??"90")+'s</div><div class="sp-sub">tick lock</div></div>'+
    '<div class="stat-pod"><span class="sp-icon">🔄</span><div class="sp-label">Refresh</div><div class="sp-val">'+(s.refreshIntervalMinutes??"120")+'min</div><div class="sp-sub">provider interval</div></div>'+
  '</div>'+
  scheduleHtml+
  tierVHtml+
  '<div class="card"><h3 style="margin-bottom:8px">🪟 Posting Windows (v12)</h3><div style="display:flex;flex-wrap:wrap;gap:6px">'+(s.postingWindows||[]).map(w=>'<span class="badge badge-blue">'+w.start+'–'+w.end+'</span>').join("")+'</div><div style="margin-top:8px;color:var(--text2);font-size:11px">Each window generates one random <code>scheduledTime</code> per day. The 20-min watcher fires on the first tick at or after it.</div></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">🌙 Quiet Hours (v12.0.2 Zero-KV)</h3><div style="display:flex;align-items:center;gap:8px"><span class="badge '+(s.quietHours?"badge-yellow":"badge-gray")+'">'+(s.quietHours?.start??"00:00")+' – '+(s.quietHours?.end??"07:30")+'</span><span style="color:var(--text2);font-size:11px">Layer 1 sleeps with 0 KV operations during this period</span></div></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">⚙️ Legacy Slots (for reference)</h3><div style="display:flex;flex-wrap:wrap;gap:6px">'+(s.slots||[]).map(t=>'<span class="badge badge-gray">'+t+"</span>").join("")+'</div><div style="margin-top:8px;color:var(--text2);font-size:11px">Legacy fixed slot times — superseded by posting windows in v12.</div></div>'+
  historyHtml;
}
async function toggleScheduler(){var st=window._lastSchedStatus;var ep=st&&st.enabled?"scheduler/pause":"scheduler/resume";const d=await api(ep,"POST");toast(d.ok?(st&&st.enabled?"⏸️ Scheduler paused":"▶️ Scheduler resumed"):"❌ Failed");loadScheduler();}
async function forcePublish(){if(!confirm("Force publish now?"))return;toast("⚡ Triggering publish...");const d=await api("scheduler/force-publish","POST");toast(d.ok?("✅ "+(d.message||"Published")):"❌ "+(d.error||"Failed"));loadScheduler();}

async function loadLogs(){
  const d=await api("logs");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  // v9.2.3: Always-on failures ring buffer (independent of DEBUG_MODE).
  const failures=d.failures||[];
  const failJson=JSON.stringify(failures.slice(0,30),null,2);
  const errJson=JSON.stringify(d.errors.slice(0,20),null,2);
  const updJson=JSON.stringify(d.updates.slice(0,20),null,2);
  c.innerHTML='<div class="card" style="border:1px solid var(--red)"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><h3 style="color:var(--red)">❌ Publish Failures ('+failures.length+')</h3><div><button class="btn btn-danger btn-sm" onclick="clearFailures()">Clear</button></div></div><p style="color:var(--text2);font-size:12px;margin-bottom:8px">Always-on ring buffer — captures every scheduled-publish failure with error, stage, and plugin info. Independent of DEBUG_MODE. (Last 30, 7-day TTL.)</p>'+
    (failures.length===0?'<p style="color:var(--text2)">No failures recorded.</p>':
      '<table style="font-size:11px;width:100%"><thead><tr><th>Time</th><th>Slot</th><th>Cat</th><th>Stage</th><th>Plugin</th><th>Error</th></tr></thead><tbody>'+
      failures.map(f=>'<tr><td style="white-space:nowrap">'+(f.time?new Date(f.time).toLocaleString():'—')+'</td><td style="white-space:nowrap">'+escapeHtml(f.date||'')+' '+escapeHtml(f.slotTime||'')+'</td><td>'+escapeHtml(f.category||'')+'</td><td>'+escapeHtml(f.stage||'')+'</td><td>'+escapeHtml(f.plugin||'—')+'</td><td style="max-width:400px;overflow:hidden;text-overflow:ellipsis" title="'+escapeHtml(f.error||'')+'">'+escapeHtml(f.error||'')+'</td></tr>').join("")+
      '</tbody></table>')+
    '<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--text2);font-size:12px">Raw JSON</summary><pre id="fail-pre" style="margin-top:8px;max-height:400px;overflow:auto">'+failJson+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement('+ "'" +'fail-pre'+ "'" +')">📋 Copy Failures JSON</button></details></div>'+
  '<div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><h3>Errors ('+d.errors.length+')</h3><div><button class="btn btn-danger btn-sm" onclick="clearLogs()">Clear</button></div></div><p style="color:var(--text2);font-size:12px">Logger ring buffer — only populated when DEBUG_MODE=true. Use the Publish Failures section above for always-on error tracking.</p><pre id="err-pre">'+errJson+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement('+ "'" +'err-pre'+ "'" +')">📋 Copy Errors</button></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Updates ('+d.updates.length+')</h3><pre id="upd-pre">'+updJson+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement('+ "'" +'upd-pre'+ "'" +')">📋 Copy Updates</button></div>';
}
async function clearFailures(){if(!confirm("Clear all recorded publish failures?"))return;const d=await api("clear/failures","POST");toast(d.ok?"✅ Failures cleared":"❌ Failed");loadLogs();}

async function loadConfig(){
  const d=await api("config");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  const cfgJson=JSON.stringify(d.settings,null,2);
  c.innerHTML='<div class="card"><h3 style="margin-bottom:8px">Config Sections</h3><table><thead><tr><th>Section</th><th>Version</th><th>Description</th></tr></thead><tbody>'+(d.sections||[]).map(s=>'<tr><td><code>'+s.key+'</code></td><td>v'+s.version+'</td><td>'+s.description+'</td></tr>').join("")+'</tbody></table></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Full Config</h3><pre id="cfg-pre">'+cfgJson+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement('+ "'" +'cfg-pre'+ "'" +')">📋 Copy Config</button></div>';
}

async function loadSystem(){
  const d=await api("system");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div class="card-grid">'+card("Version",d.version)+card("Build",d.buildDate)+card("Runtime",d.runtime)+card("KV",d.kv?"✓":"✗")+card("Plugins",d.pluginCount)+card("Providers",d.providerCount)+card("Cache",d.cacheStats?.size??0)+card("Cache TTL",(d.cacheStats?.ttlMs??0)/1000+"s")+'</div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Secrets</h3>'+Object.entries(d.hasSecrets||{}).map(([k,v])=>'<span class="badge '+(v?"badge-green":"badge-red")+'" style="margin:2px">'+k+": "+(v?"✓":"✗")+"</span>").join(" ")+'</div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Actions</h3><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-danger" onclick="clearDedup()">Clear Dedup</button><button class="btn btn-danger" onclick="clearQueue()">Clear Queue</button><button class="btn btn-ghost" onclick="clearLogs()">Clear Logs</button><button class="btn btn-ghost" onclick="clearSources()">Clear Source Caches</button><button class="btn btn-warning" onclick="clearCache()">Clear Config Cache</button><button class="btn btn-danger" onclick="resetSettings()">⚠️ Reset Settings to Defaults</button></div><div id="sys-result" style="margin-top:12px"></div></div>';
}

async function loadStats(){
  const c=document.getElementById("content");
  c.innerHTML='<div class="card">Loading statistics…</div>';
  const [hist, stats] = await Promise.all([api("history"), api("statistics/overview")]);
  if(!hist.ok){c.innerHTML='<div class="card">Error loading history</div>';return;}

  let html='<div class="fade-in">';

  // ── SUMMARY CARDS ──
  if(stats.ok){
    const s=stats;
    const statPod=(icon,label,val,sub)=>'<div class="stat-pod"><span class="sp-icon">'+icon+'</span><div class="sp-label">'+label+'</div><div class="sp-val">'+val+'</div><div class="sp-sub">'+(sub||"")+'</div></div>';
    html+='<div class="divider-label">7-Day Summary</div>';
    html+='<div class="card-grid">'+
      statPod('📊','Total Posts',s.totalPosts??0,'last 7 days')+
      statPod('⭐','Avg Quality',s.avgQuality??0,'/ 100')+
      statPod('🪙','Tokens',s.totalTokens??0,'used')+
      statPod('💲','Cost','$'+(s.totalCost??0).toFixed(4),'estimated')+
    '</div>';

    // ── DAILY SPARKLINE ──
    if(s.dailyTotals&&s.dailyTotals.length>0){
      const maxDaily=Math.max(1,...s.dailyTotals.map(d=>d.count));
      html+='<div class="card"><h3 style="margin-bottom:8px">📈 Daily Publishing (7 days)</h3><div class="sparkline">';
      for(const d of s.dailyTotals){
        const h=Math.round((d.count/maxDaily)*100);
        const dayLabel=d.date.slice(5);
        html+='<div class="spark-bar" style="height:'+Math.max(3,h)+'%"><span class="spark-tip">'+escapeHtml(dayLabel)+': '+d.count+' posts</span></div>';
      }
      html+='</div><div style="display:flex;gap:3px;margin-top:4px">';
      for(const d of s.dailyTotals){
        html+='<div style="flex:1;text-align:center;font-size:9px;color:var(--text2)">'+escapeHtml(d.date.slice(5))+'</div>';
      }
      html+='</div></div>';
    }

    // ── CATEGORY DONUT + PLUGIN BARS (side by side) ──
    html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px" class="resp-2col">';
    // Category donut
    if(s.byCategory){
      const cats=s.byCategory;
      const total=(cats.A||0)+(cats.B||0)+(cats.C||0);
      const colors={A:'#6366f1',B:'#3b82f6',C:'#22c55e'};
      const circ=2*Math.PI*45; // r=45
      let offset=0;
      let donutSegs='';
      for(const [cat,count] of Object.entries(cats)){
        if(count===0)continue;
        const frac=count/total;
        const dashLen=frac*circ;
        donutSegs+='<circle cx="60" cy="60" r="45" fill="none" stroke="'+(colors[cat]||'#888')+'" stroke-width="14" stroke-dasharray="'+dashLen+' '+(circ-dashLen)+'" stroke-dashoffset="'+(-offset)+'"/>';
        offset+=dashLen;
      }
      html+='<div class="card"><h3 style="margin-bottom:8px">📂 Category Distribution</h3>'+
        '<div style="display:flex;align-items:center;gap:16px">'+
          '<div class="donut"><svg width="120" height="120">'+donutSegs+'</svg><div class="donut-center"><div class="donut-val">'+total+'</div><div class="donut-label">Posts</div></div></div>'+
          '<div style="flex:1">'+
            (Object.entries(cats).map(([cat,count])=>{
              const pct=total>0?Math.round((count/total)*100):0;
              return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="width:10px;height:10px;border-radius:50%;background:'+(colors[cat]||'#888')+';display:inline-block"></span><span style="font-size:13px;font-weight:600">Cat '+escapeHtml(cat)+'</span><span style="color:var(--text2);font-size:12px;margin-left:auto">'+count+' ('+pct+'%)</span></div>';
            }).join(""))+
          '</div>'+
        '</div></div>';
    }
    // Plugin bars
    if(s.topPlugins&&s.topPlugins.length>0){
      const maxPlug=Math.max(1,...s.topPlugins.map(p=>p.count));
      const plugColors=['#6366f1','#818cf8','#3b82f6','#22c55e','#eab308','#ef4444','#a855f7','#ec4899','#14b8a6','#f97316'];
      html+='<div class="card"><h3 style="margin-bottom:8px">🔌 Top Plugins</h3><div class="bar-chart">';
      for(let i=0;i<s.topPlugins.length;i++){
        const p=s.topPlugins[i];
        const pct=Math.round((p.count/maxPlug)*100);
        const color=plugColors[i%plugColors.length];
        html+='<div class="bar-row"><span class="bar-label">'+escapeHtml(p.id)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+color+'">'+p.count+'</div></div></div>';
      }
      html+='</div></div>';
    }
    html+='</div>'; // end 2col grid

    // ── PUBLISHING HEATMAP ──
    if(s.heatmap&&s.heatmap.length>0){
      const days=['6d ago','5d ago','4d ago','3d ago','2d','Yesterday','Today'];
      const hm=s.heatMax||1;
      html+='<div class="card"><h3 style="margin-bottom:8px">🗓️ Publishing Heatmap (7 days × 24 hours)</h3>';
      html+='<div class="heatmap">';
      // Header row: empty + hours 0-23
      html+='<div></div>';
      for(let h=0;h<24;h++){
        html+='<div class="heatmap-axis">'+(h%6===0?String(h).padStart(2,'0'):'')+'</div>';
      }
      // Data rows
      for(let d=0;d<7;d++){
        html+='<div class="heatmap-label">'+days[d]+'</div>';
        for(let h=0;h<24;h++){
          const val=s.heatmap[d][h]||0;
          if(val===0){
            html+='<div class="heatmap-cell empty"></div>';
          }else{
            const intensity=val/hm;
            const r=Math.round(99+intensity*156);
            const g=Math.round(102+intensity*20);
            const b=Math.round(241-intensity*200);
            const bg='rgba('+r+','+g+','+b+','+(0.3+intensity*0.7)+')';
            html+='<div class="heatmap-cell" style="background:'+bg+'" title="'+days[d]+' '+String(h).padStart(2,'0')+':00 — '+val+' posts">'+(val>0?val:'')+'</div>';
          }
        }
      }
      html+='</div>';
      // Legend
      html+='<div style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:10px;color:var(--text2)"><span>Less</span>';
      for(let i=0;i<=4;i++){
        const intensity=i/4;
        const bg='rgba(99,102,241,'+(0.2+intensity*0.8)+')';
        html+='<div style="width:12px;height:12px;border-radius:2px;background:'+bg+'"></div>';
      }
      html+='<span>More</span></div></div>';
    }

    // ── QUALITY DISTRIBUTION ──
    if(s.qualityBuckets&&s.qualityBuckets.length>0){
      const qb=s.qualityBuckets;
      const maxQ=Math.max(1,...qb);
      const labels=['0-20','20-40','40-60','60-80','80-100'];
      const colors=['#ef4444','#eab308','#f97316','#3b82f6','#22c55e'];
      html+='<div class="card"><h3 style="margin-bottom:8px">⭐ Quality Score Distribution</h3>';
      for(let i=0;i<qb.length;i++){
        const pct=Math.round((qb[i]/maxQ)*100);
        const countPct=maxQ>0?Math.round((qb[i]/qb.reduce((a,b)=>a+b,0))*100):0;
        html+='<div class="dist-bar"><span class="dist-label">'+labels[i]+'</span><div class="dist-track"><div class="dist-fill" style="width:'+pct+'%;background:'+colors[i]+'">'+qb[i]+' ('+countPct+'%)</div></div></div>';
      }
      html+='</div>';
    }

    // ── HOUR-OF-DAY BAR CHART ──
    if(s.byHour&&s.byHour.length===24){
      const maxHour=Math.max(1,...s.byHour);
      html+='<div class="card"><h3 style="margin-bottom:8px">🕐 Posts by Hour of Day</h3><div class="sparkline" style="height:60px">';
      for(let h=0;h<24;h++){
        const val=s.byHour[h]||0;
        const ht=Math.round((val/maxHour)*100);
        html+='<div class="spark-bar" style="height:'+Math.max(3,ht)+'%"><span class="spark-tip">'+String(h).padStart(2,'0')+':00 — '+val+' posts</span></div>';
      }
      html+='</div><div style="display:flex;gap:3px;margin-top:4px">';
      for(let h=0;h<24;h++){
        html+='<div style="flex:1;text-align:center;font-size:8px;color:var(--text2)">'+(h%3===0?h:'')+'</div>';
      }
      html+='</div></div>';
    }
  }

  // ── TODAY'S POSTS TABLE ──
  html+='<div class="card"><h3 style="margin-bottom:8px">📅 Today ('+escapeHtml(hist.today?.date||"—")+')</h3>';
  if(!hist.today?.entries||hist.today.entries.length===0){
    html+='<p style="color:var(--text2)">No posts published today yet.</p>';
  } else {
    html+='<table><thead><tr><th>Time</th><th>Plugin</th><th>Cat</th><th>Score</th><th>Msg ID</th></tr></thead><tbody>';
    for(const e of hist.today.entries){
      const time=new Date(e.publishedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      const scoreColor=e.qualityScore>=80?'var(--green)':e.qualityScore>=60?'var(--yellow)':'var(--red)';
      html+='<tr><td>'+escapeHtml(time)+'</td><td><code>'+escapeHtml(e.pluginId)+'</code></td><td>'+escapeHtml(String(e.category))+'</td><td><span style="color:'+scoreColor+';font-weight:600">'+e.qualityScore+'</span></td><td>'+(e.telegramMessageId>0?'<span class="badge badge-green">✓</span>':'<span class="badge badge-red">❌</span>')+'</td></tr>';
    }
    html+='</tbody></table>';
  }
  html+='</div>';

  html+='</div>';
  c.innerHTML=html;
}

async function loadStrategy(){
  const d=await api("strategy");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  const s=d.strategy||{};const plan=d.plan||{};
  window._lastPlan=plan;
  const modes=[{id:"minimal",name:"Minimal",desc:"4 posts/day"},{id:"balanced",name:"Balanced",desc:"9 posts/day (default)"},{id:"active",name:"Active",desc:"13 posts/day"},{id:"ai_priority",name:"AI Priority",desc:"8 posts/day, threshold 80"},{id:"news_priority",name:"News Priority",desc:"10 posts/day, B-heavy"},{id:"custom",name:"Custom",desc:"Admin-defined"}];

  let html='<div class="fade-in">';

  // ── ACTIVE STRATEGY ──
  html+='<div class="card"><h3 style="margin-bottom:8px">🎯 Active Strategy</h3><div class="card-grid">'+
    '<div class="stat-pod"><span class="sp-icon">📊</span><div class="sp-label">Mode</div><div class="sp-val" style="font-size:16px">'+(s.mode??"balanced")+'</div><div class="sp-sub">'+(modes.find(m=>m.id===s.mode)?.desc||"")+'</div></div>'+
    '<div class="stat-pod"><span class="sp-icon">🌐</span><div class="sp-label">Language</div><div class="sp-val" style="font-size:16px">'+(s.language??"auto")+'</div><div class="sp-sub">default</div></div>'+
    '<div class="stat-pod"><span class="sp-icon">📅</span><div class="sp-label">Weekly Themes</div><div class="sp-val">'+(s.weeklyThemesEnabled?"✅ ON":"❌ OFF")+'</div><div class="sp-sub">day-based topics</div></div>'+
    '<div class="stat-pod"><span class="sp-icon">⭐</span><div class="sp-label">Quality Threshold</div><div class="sp-val">'+(s.qualityThreshold??"80")+'</div><div class="sp-sub">min score</div></div>'+
  '</div></div>';

  // ── SWITCH STRATEGY ──
  html+='<div class="card"><h3 style="margin-bottom:8px">Switch Strategy</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">'+modes.map(m=>'<button class="btn '+(s.mode===m.id?"btn-accent":"")+'" onclick="switchStrategy('+ "'" +m.id+ "'" +')" style="text-align:left;padding:10px"><div style="font-weight:600">'+m.name+'</div><div style="font-size:11px;color:var(--text2)">'+m.desc+'</div></button>').join("")+'</div></div>';

  // ── CUSTOM DISTRIBUTION ──
  if(s.mode==="custom"){
    html+='<div class="card"><h3 style="margin-bottom:8px">Custom Distribution</h3><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><label>A: <input type="number" id="cust-A" value="'+(s.customDistribution?.A??4)+'" style="width:60px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:4px;border-radius:4px"></label><label>B: <input type="number" id="cust-B" value="'+(s.customDistribution?.B??2)+'" style="width:60px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:4px;border-radius:4px"></label><label>C: <input type="number" id="cust-C" value="'+(s.customDistribution?.C??3)+'" style="width:60px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:4px;border-radius:4px"></label><button class="btn" onclick="saveCustomDist()">Save</button></div></div>';
  }

  // ── v12.0.12: WEEKLY SCHEDULE OVERVIEW ──
  if(d.weeklyThemes){
    html+='<div class="card" style="border:1px solid var(--accent)"><h3 style="margin-bottom:8px">📅 Weekly Schedule — Themes & Topics</h3>';
    html+='<p style="color:var(--text2);font-size:12px;margin-bottom:10px">Each day has a theme that influences provider selection. On themed days, providers matching the theme topics are prioritized.</p>';
    const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dayEmojis=['☀️','📅','🔥','⭐','💡','🎉','🌙'];
    const today=new Date().getDay();
    for(const theme of d.weeklyThemes){
      const isToday=theme.day===today;
      const borderColor=isToday?'var(--accent)':'var(--border)';
      const bg=isToday?'rgba(99,102,241,.08)':'var(--surface)';
      html+='<div style="display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid '+borderColor+';border-radius:8px;margin-bottom:6px;background:'+bg+'">'+
        '<span style="font-size:20px">'+(dayEmojis[theme.day]||'📅')+'</span>'+
        '<div style="flex:1">'+
          '<div style="font-weight:600;font-size:14px">'+escapeHtml(theme.dayName)+(isToday?' <span class="badge badge-blue" style="margin-left:4px">TODAY</span>':'')+'</div>'+
          '<div style="font-size:11px;color:var(--text2);margin-top:2px">'+theme.topics.map(t=>'<span class="badge badge-gray" style="margin:1px">'+escapeHtml(t)+'</span>').join(' ')+'</div>'+
        '</div>'+
      '</div>';
    }
    html+='</div>';
  }

  // ── DAILY PLAN ──
  html+='<div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><h3>📋 Daily Plan ('+plan.date+') — v12 Window / Scheduled</h3><div style="display:flex;gap:4px"><button class="btn btn-sm btn-accent" onclick="fireNextSlot()">⚡ Fire Next Slot</button><button class="btn btn-sm" onclick="regeneratePlan()">🔄 Regenerate</button></div></div>';

  if(plan.posts&&plan.posts.length>0){
    html+='<table style="font-size:12px"><thead><tr><th>#</th><th>Window</th><th>🎯 Scheduled</th><th>Cat</th><th>Provider</th><th>Priority</th><th>Status</th></tr></thead><tbody>';
    for(const p of plan.posts){
      const st=p.status||"pending";
      const badge=st==="published"?'<span class="badge badge-green">✅ Published</span>':st==="failed"?'<a href="javascript:void(0)" onclick="showPostError('+p.index+')" style="text-decoration:none"><span class="badge badge-red" style="cursor:pointer" title="Click to see error">❌ Failed</span></a>':st==="backup"?'<a href="javascript:void(0)" onclick="showPostError('+p.index+')" style="text-decoration:none"><span class="badge badge-blue" style="cursor:pointer" title="Click to see why primary failed">🔄 Backup</span></a>':st==="publishing"?'<span class="badge badge-yellow">🔄 Publishing</span>':'<span class="badge badge-yellow">⏳ Pending</span>';
      const win=p.time+'-'+(p.windowEnd||p.time);
      const sched=p.scheduledTime||p.time;
      const schedStyle=st==='pending'?' style="color:var(--accent);font-weight:bold"':'';
      html+='<tr><td>#'+p.index+'</td><td style="color:var(--text2)">'+win+'</td><td'+schedStyle+'>'+sched+'</td><td>'+p.category+'</td><td>'+(p.provider||"—")+'</td><td style="font-size:11px">'+p.priority+'</td><td>'+badge+'</td></tr>';
    }
    html+='</tbody></table>';
    html+='<div style="margin-top:8px;color:var(--text2);font-size:11px">🎯 <b>Scheduled</b> = random time within each window (v12 EXACT trigger). The 20-min watcher fires on the first tick at or after this time.</div>';
  } else {
    html+='<p>No plan generated yet.</p>';
  }

  if(plan.theme){
    html+='<p style="margin-top:8px;color:var(--text2)">📅 Today Theme: <b>'+plan.theme.dayName+'</b> — '+plan.theme.topics.join(", ")+'</p>';
  }
  if(plan.validation){
    html+='<p style="color:var(--text2);font-size:11px">Validation: '+(plan.validation.valid?"✅ Valid":"❌ Invalid")+' ('+plan.validation.warnings.length+' warnings)</p>';
  }
  html+='</div>';

  // ── v12.0.12: TIER V SCHEDULED CONTENT ──
  if(d.tierVEntries&&d.tierVEntries.length>0){
    html+='<div class="card" style="border:1px solid #a855f7"><h3 style="margin-bottom:8px;color:#a855f7">🟣 Tier V — Scheduled Content (Fixed Schedule)</h3>';
    html+='<p style="color:var(--text2);font-size:12px;margin-bottom:10px">Tier V posts have a FIXED schedule (no random jitter). They publish at the exact configured time every day.</p>';
    html+='<table style="font-size:12px"><thead><tr><th>ID</th><th>⏰ Time</th><th>Provider</th><th>Status</th><th>Description</th></tr></thead><tbody>';
    for(const entry of d.tierVEntries){
      const st=d.tierVStatus?d.tierVStatus[entry.id]:null;
      const pubBadge=st&&st.published?'<span class="badge badge-green">✅ Published</span>':'<span class="badge badge-yellow">⏳ Pending</span>';
      html+='<tr style="background:rgba(168,85,247,.05)">'+
        '<td><code>'+escapeHtml(entry.id)+'</code></td>'+
        '<td style="color:#a855f7;font-weight:bold">'+escapeHtml(entry.time)+'</td>'+
        '<td>'+escapeHtml(entry.providerId)+'</td>'+
        '<td>'+(entry.enabled?pubBadge:'<span class="badge badge-red">Disabled</span>')+'</td>'+
        '<td style="color:var(--text2);font-size:11px">'+escapeHtml(entry.description||"")+'</td>'+
      '</tr>';
    }
    html+='</tbody></table>';
    html+='<div style="margin-top:8px;color:var(--text2);font-size:11px">🟣 Tier V posts appear in the Daily Plan table with a purple theme. They are checked by the 20-min watcher alongside normal window slots.</div>';
    html+='</div>';
  }

  html+='</div>';
  c.innerHTML=html;
}
function showPostError(idx){
  // Find the post by index in the most recently-loaded plan.
  if(!window._lastPlan||!window._lastPlan.posts){alert("Plan data not available. Reload the Strategy page and try again.");return;}
  const p=window._lastPlan.posts.find(x=>x.index===idx);
  if(!p){alert("Post #"+idx+" not found in plan.");return;}
  const title="Post #"+idx+" — "+(p.status||"unknown");
  const lines=[];
  lines.push("Status: "+(p.status||"unknown"));
  lines.push("Scheduled: "+p.date+" at "+p.time);
  lines.push("Category: "+p.category);
  lines.push("Provider: "+(p.provider||"—"));
  if(p.error){lines.push("");lines.push("Error:");lines.push(p.error);}
  if(p.failedStage){lines.push("");lines.push("Failed stage: "+p.failedStage);}
  if(p.failedPlugin){lines.push("Plugin attempted: "+p.failedPlugin);}
  if(p.failedAt){lines.push("Failed at: "+new Date(p.failedAt).toISOString());}
  if(!p.error&&!p.failedStage){lines.push("");lines.push("(No error details recorded. This can happen if the failure occurred before v9.2.3 or if the slot was marked failed without an error message.)");}
  alert(title+"\\n\\n"+lines.join("\\n"));
}
async function switchStrategy(mode){const d=await api("strategy","POST",{mode});toast(d.ok?"✅ Strategy: "+mode:"❌ Failed");loadStrategy();}
async function saveCustomDist(){const A=parseInt(document.getElementById("cust-A").value)||0;const B=parseInt(document.getElementById("cust-B").value)||0;const C=parseInt(document.getElementById("cust-C").value)||0;const d=await api("strategy","POST",{customDistribution:{A,B,C}});toast(d.ok?"✅ Custom distribution saved":"❌ Failed");loadStrategy();}
async function regeneratePlan(){toast("🔄 Regenerating plan...");const d=await api("strategy/regenerate","POST");toast(d.ok?"✅ Plan regenerated":"❌ Failed");loadStrategy();}
async function fireNextSlot(){if(!confirm("Force-fire the next due slot NOW? This will run the full pipeline and publish to the channel."))return;toast("⚡ Firing next slot...");const d=await api("scheduler/force-publish","POST");toast(d.ok?(d.fired?"✅ "+(d.message||"Published!"):"⚠️ "+(d.message||"No due slots")):"❌ "+(d.error||"Failed"));loadStrategy();}

async function loadDebug(){
  const d=await api("debug");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  const r=d.runtime||{};
  c.innerHTML='<div class="card-grid">'+card("Version",d.version)+card("KV Health",d.kvHealth?"✅":"❌")+card("Cache Size",d.cacheStats?.size??0)+card("Cache TTL",((d.cacheStats?.ttlMs??0)/1000)+"s")+'</div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Runtime Config</h3>'+preWithCopy("rt-cfg",JSON.stringify(r,null,2))+'</div>'+
  (d.tickLog?'<div class="card"><h3 style="margin-bottom:8px">Last Tick Log</h3>'+preWithCopy("tick-log",JSON.stringify(d.tickLog,null,2))+'</div>':'')+
  (d.pipelineLog?'<div class="card"><h3 style="margin-bottom:8px">Last Pipeline Log</h3>'+preWithCopy("pipe-log",JSON.stringify(d.pipelineLog,null,2))+'</div>':'')+
  '<div class="card"><h3 style="margin-bottom:8px">Secrets Status</h3>'+Object.entries(d.secrets||{}).map(([k,v])=>'<span class="badge '+(v?"badge-green":"badge-red")+'" style="margin:2px">'+k+": "+(v?"✓":"✗")+"</span>").join(" ")+'</div>';
}

async function loadSettings(){
  const d=await api("config");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  const s=d.settings||{};
  const previewMode=s.telegram?.linkPreviewMode??"smart";
  c.innerHTML='<div class="card"><h3 style="margin-bottom:8px">🔧 Runtime Settings</h3><p style="color:var(--text2);margin-bottom:12px">Edit and save — changes apply immediately without redeployment.</p>'+
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'+
  '<div><label style="color:var(--text2);font-size:12px">Language</label><select id="set-lang" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px;border-radius:6px"><option value="auto" '+(s.language?.default==="auto"?"selected":"")+'>Auto</option><option value="fa" '+(s.language?.default==="fa"?"selected":"")+'>Persian</option><option value="en" '+(s.language?.default==="en"?"selected":"")+'>English</option></select></div>'+
  '<div><label style="color:var(--text2);font-size:12px">Quality Threshold</label><input type="number" id="set-qt" value="'+(s.ai?.qualityThreshold??60)+'" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px;border-radius:6px"></div>'+
  '<div><label style="color:var(--text2);font-size:12px">Min Gap (minutes)</label><input type="number" id="set-gap" value="'+(s.scheduler?.minGapMinutes??90)+'" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px;border-radius:6px"></div>'+
  '<div><label style="color:var(--text2);font-size:12px">Refresh Interval (minutes)</label><input type="number" id="set-refresh" value="'+(s.scheduler?.refreshIntervalMinutes??120)+'" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px;border-radius:6px"></div>'+
  '<div><label style="color:var(--text2);font-size:12px">Quiet Hours Start</label><input type="text" id="set-qh-start" value="'+(s.scheduler?.quietHours?.start??"00:00")+'" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px;border-radius:6px"></div>'+
  '<div><label style="color:var(--text2);font-size:12px">Quiet Hours End</label><input type="text" id="set-qh-end" value="'+(s.scheduler?.quietHours?.end??"07:30")+'" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px;border-radius:6px"></div>'+
  '<div><label style="color:var(--text2);font-size:12px">🔗 Link Preview Mode</label><select id="set-preview" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px;border-radius:6px"><option value="smart" '+(previewMode==="smart"?"selected":"")+'>Smart (Recommended)</option><option value="disabled" '+(previewMode==="disabled"?"selected":"")+'>Disabled</option><option value="always" '+(previewMode==="always"?"selected":"")+'>Always Enabled</option></select></div>'+
  '</div>'+
  '<button class="btn" style="margin-top:12px" onclick="saveSettings()">💾 Save Settings</button></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Full Config (read-only)</h3>'+preWithCopy("full-cfg",JSON.stringify(s,null,2))+'</div>';
}
async function saveSettings(){
  const lang=document.getElementById("set-lang").value;
  const qt=parseInt(document.getElementById("set-qt").value)||60;
  const gap=parseInt(document.getElementById("set-gap").value)||90;
  const refresh=parseInt(document.getElementById("set-refresh").value)||120;
  const qhStart=document.getElementById("set-qh-start").value;
  const qhEnd=document.getElementById("set-qh-end").value;
  const preview=document.getElementById("set-preview")?document.getElementById("set-preview").value:"smart";
  const d=await api("settings","POST",{
    language:{_version:1,default:lang,supported:["en","fa"],autoDetect:true},
    ai:{qualityThreshold:qt},
    scheduler:{minGapMinutes:gap,refreshIntervalMinutes:refresh,quietHours:{start:qhStart,end:qhEnd}},
    telegram:{linkPreviewMode:preview}
  });
  toast(d.ok?"✅ Settings saved":"❌ "+(d.error||"Failed"));
}

function loadAbout(){
  document.getElementById("content").innerHTML='<div class="card"><h1 style="font-size:24px;margin-bottom:12px">🤖 Fredy</h1><p style="color:var(--text2);margin-bottom:16px">AI-powered Telegram Content Engine</p><div class="card-grid">'+card("Version",APP_VERSION)+card("License","MIT")+card("Runtime","Cloudflare Workers")+card("Language","TypeScript")+card("AI","Gemini + OpenRouter")+card("Storage","Cloudflare KV")+'</div><p style="color:var(--text2)">Built for the developer community.</p></div>';
}

async function clearLogs(){const d=await api("clear/logs","POST");toast(d.ok?"✅ Logs cleared":"❌ Failed");}
async function clearDedup(){const d=await api("clear/dedup","POST");const el=document.getElementById("sys-result");if(el)el.innerHTML=preWithCopy("dedup-r",JSON.stringify(d,null,2));toast(d.ok?"✅ Dedup cleared":"❌ Failed");}
async function clearQueue(){const d=await api("clear/queue","POST");const el=document.getElementById("sys-result");if(el)el.innerHTML=preWithCopy("queue-r",JSON.stringify(d,null,2));toast(d.ok?"✅ Queue cleared":"❌ Failed");}
async function clearSources(){const d=await api("clear/sources","POST");const el=document.getElementById("sys-result");if(el)el.innerHTML=preWithCopy("src-r",JSON.stringify(d,null,2));toast(d.ok?"✅ Source caches cleared ("+d.deleted+" keys)":"❌ Failed");}
async function clearCache(){const d=await api("clear/cache","POST");toast(d.ok?"✅ Config cache cleared":"❌ Failed");}
async function resetSettings(){if(!confirm("⚠️ This will reset ALL settings to defaults. Continue?"))return;const d=await api("reset/settings","POST");const el=document.getElementById("sys-result");if(el)el.innerHTML=preWithCopy("reset-r",JSON.stringify(d,null,2));toast(d.ok?"✅ Settings reset to defaults":"❌ Failed");}
function refresh(){loadPage(currentPage);}
buildNav();navigate("dashboard");setInterval(()=>{if(currentPage==="dashboard")loadDashboard();},30000);
</script></body></html>`;
}
