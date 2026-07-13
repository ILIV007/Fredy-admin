/**
 * src/entry/manager.ts
 * /Manager — production-grade management dashboard v3.
 * Enhanced with: back-test, test-all plugins, copy buttons, full API.
 */

import type { Env, Container } from "../types/env";

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
    return new Response(managerHTML(env), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const apiPath = url.pathname.replace(/^\/[Mm]anager\/api\//, "");

  // ── Health ──
  if (apiPath === "health" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const stats = await container.kv.getGlobalStats().catch(() => ({ processed: 0, published: 0, rejected: 0, failed: 0 }));
    const state = await container.config.getState(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const schedStatus = await container.scheduler.status().catch(() => null);
    const queueDepths = await container.queue.depth().catch(() => []);
    const lastRefresh = await container.kv.get("fredy:tick:lastRefresh").catch(() => null);
    const lastTick = await container.kv.get("fredy:tick:lastTick").catch(() => null);
    return json({ ok: true, version: "4.5.1", bot: { enabled: settings?.general.botEnabled, maintenance: settings?.general.maintenanceMode }, scheduler: { enabled: settings?.scheduler.enabled, nextSlot: schedStatus?.nextSlot, postsToday: schedStatus?.postsPublishedToday }, approveMode: settings?.approveMode, language: settings?.language.default, aiProvider: settings?.ai.primaryProvider, plugins: { enabled: container.plugins.list().filter(p => container.plugins.isEnabled(p.metadata.id)).length, total: container.plugins.list().length }, categories: { A: settings?.categories.A.enabled, B: settings?.categories.B.enabled, C: settings?.categories.C.enabled }, stats, state, queueDepths, lastRefresh: lastRefresh ? Number(lastRefresh) : null, lastTick: lastTick ? Number(lastTick) : null, hasSecrets: { botToken: !!env.BOT_TOKEN, gemini: !!env.GEMINI_API_KEY, openrouter: !!env.OPENROUTER_API_KEY, newsapi: !!env.NEWSAPI_KEY, nasa: !!env.NASA_API_KEY, github: !!env.GITHUB_TOKEN, cronKey: !!env.CRON_KEY, webhookSecret: !!env.WEBHOOK_SECRET, debugToken: !!env.DEBUG_TOKEN } });
  }

  // ── Plugins ──
  if (apiPath === "plugins" && request.method === "GET") {
    const plugins = container.plugins.list().map(p => ({ id: p.metadata.id, name: p.metadata.name, version: p.metadata.version, category: p.metadata.category, priority: p.metadata.priority, enabled: container.plugins.isEnabled(p.metadata.id), supportsImages: p.metadata.supportsImages, rateLimit: p.metadata.rateLimit, homepage: p.metadata.homepage }));
    const statuses = container.plugins.getAllStatuses();
    return json({ ok: true, plugins, statuses });
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
    return json({ ok: true, depths, limits: settings ? { A: { min: settings.content.queueMinA, target: settings.content.queueTargetA }, B: { min: settings.content.queueMinB, target: settings.content.queueTargetB }, C: { min: settings.content.queueMinC, target: settings.content.queueTargetC } } : null });
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

  // ── History ──
  if (apiPath === "history" && request.method === "GET") {
    const today = await container.history.getToday().catch(() => ({ entries: [], total: 0, date: "" }));
    const recent = await container.history.getRecent(7).catch(() => []);
    return json({ ok: true, today, recent });
  }

  // ── Logs ──
  if (apiPath === "logs" && request.method === "GET") {
    const updates = await container.debug.getRecentUpdates().catch(() => []);
    const errors = await container.debug.getRecentErrors().catch(() => []);
    return json({ ok: true, updates, errors });
  }

  // ── Config ──
  if (apiPath === "config" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    return json({ ok: true, settings, sections: container.config.listSections() });
  }

  // ── System ──
  if (apiPath === "system" && request.method === "GET") {
    return json({ ok: true, version: "4.5.1", buildDate: "2026-07-12", runtime: "cloudflare-workers", kv: !!env.Fredy_SETTINGS, cacheStats: container.config.cacheStats(), pluginCount: container.plugins.list().length, providerCount: container.providers.list().length, hasSecrets: { botToken: !!env.BOT_TOKEN, gemini: !!env.GEMINI_API_KEY, openrouter: !!env.OPENROUTER_API_KEY, cronKey: !!env.CRON_KEY } });
  }

  // ── Test single plugin ──
  const pluginMatch = apiPath.match(/^test\/plugin\/([\w-]+)$/);
  if (pluginMatch && request.method === "POST") {
    try {
      const items = await container.plugins.fetchFrom(pluginMatch[1]!);
      return json({ ok: true, itemCount: items.length, items: items.slice(0, 3).map(i => ({ id: i.id, title: i.title, url: i.url })) });
    } catch (error) { return json({ ok: false, error: errMsg(error) }, 500); }
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
      version: "4.5.1",
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
          version: "4.5.1",
          buildDate: "2026-07-12",
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

  // ── Clear actions ──
  if (apiPath === "clear/logs" && request.method === "POST") { await container.debug.clearLogs(); return json({ ok: true }); }
  if (apiPath === "clear/dedup" && request.method === "POST") { await container.duplicateDetector.clear(); return json({ ok: true }); }
  if (apiPath === "clear/queue" && request.method === "POST") { await container.queue.clearAll(); return json({ ok: true }); }

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

    // Stage 1: Fetch from plugin
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

      // Stage 2: Try each item through the pipeline until one succeeds.
      // If all items fail, report the last error.
      let result = null;
      const attempts = [];
      for (let idx = 0; idx < Math.min(items.length, 5); idx++) {
        const item = items[idx]!;
        const t1 = Date.now();
        const r = await container.content.process(item, lang, { skipDedup: true });
        attempts.push({
          itemIndex: idx,
          itemId: item.id,
          ok: r.ok,
          stage: r.stage,
          error: r.error,
          durationMs: Date.now() - t1,
        });
        if (r.ok && r.content) {
          result = r;
          break;
        }
      }

      stages["process"] = {
        ok: !!result,
        attempts,
        totalAttempts: attempts.length,
        contentId: result?.content?.id,
        error: result ? undefined : (attempts[attempts.length - 1]?.error ?? "All items rejected"),
      };

      if (!result || !result.content) {
        report["ok"] = false;
        report["error"] = `All ${attempts.length} items were rejected (quality or processing failed)`;
        return json(report);
      }

      // Stage 3: Publish to channel
      const t2 = Date.now();
      const pubResult = await container.finalPublisher.publish(result.content);
      stages["publish"] = {
        ok: pubResult.ok,
        durationMs: Date.now() - t2,
        messageId: pubResult.telegramMessageId,
        chatId: pubResult.telegramChatId,
        error: pubResult.error,
      };

      // Send the actual post to admin PM + notification with API details.
      if (pubResult.ok) {
        const adminId = Number(env.ADMIN_ID ?? "0");
        if (adminId > 0) {
          // Send the actual post content to admin PM.
          await container.tg.sendMessage(adminId, result.content.text, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }).catch(() => {});
          // Send notification with API details.
          await container.tg.sendMessage(adminId, [
            `📤 <b>Post published from: ${pluginId}</b>`,
            ``,
            `<b>Category:</b> ${result.content.category}`,
            `<b>AI:</b> ${result.content.aiProvider}/${result.content.aiModel}`,
            `<b>Quality:</b> ${result.content.quality.overallScore}`,
            `<b>Tokens:</b> ${result.content.tokensUsed}`,
            `<b>Channel Msg ID:</b> ${pubResult.telegramMessageId}`,
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
        sourceUrl: result.content.sourceUrl,
        language: result.content.language,
        aiProvider: result.content.aiProvider,
        aiModel: result.content.aiModel,
        qualityScore: result.content.quality.overallScore,
        tokensUsed: result.content.tokensUsed,
      } : null;

      return json(report);
    } catch (error) {
      stages["error"] = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.split("\n").slice(0, 5) : undefined,
      };
      report["ok"] = false;
      report["error"] = error instanceof Error ? error.message : String(error);
      return json(report, 500);
    }
  }

  // ── Full Checkup: complete system diagnostic JSON ──
  if (apiPath === "checkup" && request.method === "POST") {
    const report: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      version: "4.5.1",
    };

    // 1. System info
    try {
      const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
      report["system"] = {
        version: "4.5.1",
        buildDate: "2026-07-13",
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
@media(max-width:768px){:root{--sidebar-w:200px}.sidebar{transform:translateX(calc(-1*var(--sidebar-w)))}.sidebar.open{transform:translateX(0)}.main{margin-left:0}}
</style></head><body>
<div class="sidebar" id="sidebar"><div class="sidebar-header"><span style="font-size:20px">🤖</span><h1>Fredy</h1></div><div class="sidebar-nav" id="nav"></div></div>
<div class="main" id="main"><div class="topbar"><button onclick="toggleSidebar()">☰</button><h2 id="page-title">Dashboard</h2><div style="margin-left:auto;display:flex;gap:8px"><button onclick="refresh()" class="btn btn-ghost btn-sm">🔄 Refresh</button></div></div><div class="content" id="content"></div></div>
<script>
const TOKEN="${token}";const API="/Manager/api/";
const navItems=[{id:"dashboard",icon:"📊",label:"Dashboard"},{id:"post",icon:"📤",label:"Post to Channel"},{id:"backtest",icon:"🧪",label:"Back-Test"},{id:"plugins",icon:"🔌",label:"Plugins"},{id:"queue",icon:"📥",label:"Queue"},{id:"ai",icon:"🤖",label:"AI"},{id:"scheduler",icon:"📅",label:"Scheduler"},{id:"statistics",icon:"📈",label:"Statistics"},{id:"logs",icon:"📜",label:"Logs"},{id:"config",icon:"⚙️",label:"Configuration"},{id:"system",icon:"🖥️",label:"System"},{id:"about",icon:"ℹ️",label:"About"}];
let currentPage="dashboard";
function buildNav(){document.getElementById("nav").innerHTML=navItems.map(i=>'<div class="nav-item" onclick="navigate(\\''+i.id+'\\')" id="nav-'+i.id+'"><span class="nav-icon">'+i.icon+'</span>'+i.label+'</div>').join("");}
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
function preWithCopy(id,content){return '<pre id="'+id+'">'+content+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement(\\''+id+'\\')" style="margin-top:4px">📋 Copy</button>';}
function loadPage(id){const c=document.getElementById("content");c.innerHTML='<div class="card">Loading…</div>';({dashboard:loadDashboard,post:loadPost,backtest:loadBacktest,plugins:loadPlugins,queue:loadQueue,ai:loadAI,scheduler:loadScheduler,logs:loadLogs,config:loadConfig,system:loadSystem,statistics:loadStats,about:loadAbout}[id]||(()=>c.innerHTML='<div class="card">Page not found.</div>'))();}

async function loadDashboard(){
  const d=await api("health");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div class="card" style="border:1px solid var(--accent);background:linear-gradient(135deg,rgba(99,102,241,.1),rgba(129,140,248,.05))"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">🚀 Quick Test Everything</h3><span class="badge badge-blue">v'+d.version+'</span></div><p style="color:var(--text2);margin-bottom:12px">Runs all 9 system checks + 12 plugin tests + AI test in one click. Full copyable JSON report.</p><div style="display:flex;gap:8px"><button class="btn" onclick="testEverything()">▶️ Test Everything</button><button class="btn btn-ghost" onclick="testAllPlugins()">🔌 Test Plugins Only</button></div><div id="everything-result" style="margin-top:12px"></div></div>'+
  '<div class="card-grid">'+card("Version",d.version)+card("Bot",d.bot?.enabled?badge(1):badge(0))+card("Scheduler",d.scheduler?.enabled?badge(1):badge(0))+card("Approve",d.approveMode?badge(1):badge(0))+card("AI",d.aiProvider??"—")+card("Language",d.language??"—")+card("Plugins",d.plugins?.enabled+"/"+d.plugins?.total)+card("Posts Today",d.scheduler?.postsToday??0)+card("Next Slot",d.scheduler?.nextSlot?.time??"—")+card("Last Refresh",fmtAgo(d.lastRefresh))+card("Last Tick",d.lastTick?fmtAgo(d.lastTick):"—")+'</div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Global Stats</h3><div class="card-grid">'+card("Processed",d.stats?.processed??0)+card("Published",d.stats?.published??0)+card("Rejected",d.stats?.rejected??0)+card("Failed",d.stats?.failed??0)+'</div></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Secrets</h3>'+Object.entries(d.hasSecrets||{}).map(([k,v])=>'<span class="badge '+(v?"badge-green":"badge-red")+'" style="margin:2px">'+k+": "+(v?"✓":"✗")+"</span>").join(" ")+'</div>';
}

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
    '<div style="margin-top:12px"><h4 style="margin-bottom:6px">📋 Full JSON Report (copyable)</h4><pre id="everything-pre" style="max-height:500px">'+escapeHtml(jsonStr)+'</pre><button class="btn btn-sm" onclick="copyElement(\\'everything-pre\\')">📋 Copy Full Report</button></div></div>';
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
  // Only show enabled plugins
  const enabledPlugins=d.plugins.filter(p=>p.enabled);
  c.innerHTML='<div class="card"><h3 style="margin-bottom:8px">📤 Post to Channel</h3><p style="color:var(--text2);margin-bottom:12px">Select a source API below to fetch content, process it through the AI pipeline, and publish immediately to the channel. The system tries up to 5 items per API until one passes quality. A detailed JSON report will appear at the bottom.</p></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">🔌 Available APIs ('+enabledPlugins.length+' enabled)</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">'+
  enabledPlugins.map(p=>'<button class="btn" style="text-align:left;padding:10px" onclick="postToChannel(\\''+p.id+'\\')"><div style="font-weight:600">'+p.name+'</div><div style="font-size:11px;color:var(--text2)">Cat '+p.category+'</div></button>').join("")+
  '</div></div><div id="post-result"></div>';
}

async function postToChannel(pluginId){
  const w=document.getElementById("post-result");
  w.innerHTML='<div class="card">⏳ Fetching from '+pluginId+' and publishing to channel...</div>';
  toast("📤 Posting from "+pluginId+"...");
  try{
    const d=await api("post/channel","POST",{pluginId});
    const jsonStr=JSON.stringify(d,null,2);
    const ok=d.ok;
    // Build stage summary
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
    // Content preview
    let contentHtml="";
    if(d.content){
      contentHtml='<div class="card" style="margin-top:8px"><h4 style="margin-bottom:6px">📝 Content Published</h4>'+
        '<div style="font-size:12px;color:var(--text2);margin-bottom:4px"><b>Plugin:</b> '+d.content.pluginId+' · <b>Category:</b> '+d.content.category+' · <b>AI:</b> '+d.content.aiProvider+'/'+d.content.aiModel+' · <b>Score:</b> '+d.content.qualityScore+' · <b>Tokens:</b> '+d.content.tokensUsed+'</div>'+
        '<div style="background:var(--surface2);padding:8px;border-radius:4px;font-size:12px;max-height:200px;overflow-y:auto">'+escapeHtml(d.content.textPreview||'')+'</div></div>';
    }
    w.innerHTML='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">'+(ok?'✅ Posted Successfully':'❌ Post Failed')+'</h3><span class="badge '+(ok?'badge-green':'badge-red')+'">'+pluginId+'</span></div>'+
      stageHtml+contentHtml+
      '<div style="margin-top:12px"><h4 style="margin-bottom:6px">📋 Full JSON Report</h4><pre id="post-json" style="max-height:500px">'+escapeHtml(jsonStr)+'</pre><button class="btn btn-sm" onclick="copyElement(\\'post-json\\')">📋 Copy Report</button></div></div>';
    toast(ok?"✅ Posted to channel!":"❌ Post failed");
  }catch(e){
    w.innerHTML='<div class="card">❌ Error: '+escapeHtml(String(e))+'</div>';
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
  d.results.map(t=>'<div class="test-result '+(t.ok?"test-pass":"test-fail")+'"><span>'+(t.ok?"✅":"❌")+'</span><span style="font-weight:600">'+t.test+'</span><span style="color:var(--text2);flex:1">'+t.detail+'</span><span style="color:var(--text2);font-size:11px">'+t.durationMs+'ms</span><button class="btn btn-sm btn-ghost" onclick="copyText(\\''+t.test+": "+t.detail+'\\')">📋</button></div>').join("");
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
    '<button class="btn" onclick="copyElement(\\'checkup-json\\')">📋 Copy Full JSON Report</button></div>';
    toast(pct>=80?"✅ System healthy!":(pct>=50?"⚠️ Some issues":"❌ Critical issues"));
  }catch(e){
    r.innerHTML='<div class="card">❌ Checkup failed: '+escapeHtml(String(e))+'</div>';
    toast("❌ Checkup failed");
  }
}

async function loadPlugins(){
  const d=await api("plugins");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div style="margin-bottom:12px;display:flex;gap:8px"><button class="btn" onclick="testAllPlugins()">🧪 Test All Plugins</button></div>'+
  '<table><thead><tr><th>ID</th><th>Name</th><th>Cat</th><th>Enabled</th><th>Priority</th><th>Rate Limit</th><th>Test</th></tr></thead><tbody>'+
  d.plugins.map(p=>'<tr><td><code>'+p.id+'</code></td><td>'+p.name+'</td><td>'+p.category+'</td><td>'+badge(p.enabled)+'</td><td>'+p.priority+'</td><td>'+p.rateLimit+'/hr</td><td><button class="btn btn-sm" onclick="testPlugin(\\''+p.id+'\\')">Test</button></td></tr>').join("")+'</tbody></table>'+
  '<div id="test-all-results"></div>';
}

async function testAllPlugins(){
  const r=document.getElementById("test-all-results");r.innerHTML='<div class="card">Testing all plugins…</div>';
  const d=await api("test/all-plugins","POST");
  r.innerHTML='<div class="card"><h3 style="margin-bottom:8px">Test All Results</h3>'+
  d.results.map(t=>'<div class="test-result '+(t.ok?"test-pass":"test-fail")+'"><span>'+(t.ok?"✅":"❌")+'</span><span style="font-weight:600">'+t.id+'</span><span style="color:var(--text2);flex:1">'+(t.ok?t.itemCount+" items":t.error)+'</span><button class="btn btn-sm btn-ghost" onclick="copyText(\\''+t.id+": "+(t.ok?t.itemCount+" items":t.error)+'\\')">📋</button></div>').join("")+'</div>';
  toast("Test all complete");
}

async function testPlugin(id){toast("Testing "+id+"...");const d=await api("test/plugin/"+id,"POST");toast(d.ok?"✅ "+id+": "+d.itemCount+" items":"❌ "+id+": "+d.error);}

async function loadQueue(){
  const d=await api("queue");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  const l=d.limits||{};
  c.innerHTML=d.depths.map(q=>{const lim=l[q.category]||{min:0,target:0};const pct=lim.target>0?Math.min(100,q.depth/lim.target*100):0;
  return '<div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><span class="badge badge-blue">Category '+q.category+'</span><span>'+q.depth+" / "+lim.target+'</span></div><div class="progress"><div class="progress-bar" style="width:'+pct+'%"></div></div><div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:var(--text2)"><span>Min: '+lim.min+'</span><span>Target: '+lim.target+'</span></div></div>';}).join("");
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
      models.map(m=>'<tr><td style="color:var(--accent);font-weight:600">'+m.priority+'</td><td><code>'+m.model+'</code></td><td>'+(m.enabled?'<span class="badge badge-green">Ready</span>':'<span class="badge badge-gray">Off</span>')+'</td><td><button class="btn btn-sm" onclick="testAIModel(\\''+pid+'\\',\\''+m.model.replace(/'/g,"")+'\\')">🧪 Test</button></td></tr>').join('')+
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
  if(w)w.innerHTML='<h4 style="margin:8px 0">Result: '+pid+'/'+model+'</h4><pre id="ai-model-pre">'+escapeHtml(jsonStr)+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement(\\'ai-model-pre\\')">📋 Copy</button>';
  toast(d.ok?"✅ "+model+" OK":"❌ "+model+" failed");
}

async function testAI(){
  const text=document.getElementById("ai-test")?.value||"Test about AI";
  const w=document.getElementById("ai-result-wrap");w.innerHTML='<div class="card">Testing...</div>';
  const d=await api("test/ai","POST",{text});
  const jsonStr=JSON.stringify(d,null,2);
  w.innerHTML='<pre id="ai-pre">'+jsonStr+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement(\\'ai-pre\\')">📋 Copy Result</button>';
  toast(d.ok?"✅ AI OK":"❌ AI failed");
}

async function loadScheduler(){
  const d=await api("scheduler");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  const s=d.settings||{};const st=d.status||{};
  c.innerHTML='<div class="card-grid">'+card("Enabled",st.enabled?badge(1):badge(0))+card("Next Slot",st.nextSlot?.time??"—")+card("Posts Today",st.postsPublishedToday??0)+card("Queue",st.queueDepth??0)+card("Timezone",s.timezone??"—")+card("Jitter","±"+(s.jitterMinutes??"0")+"min")+card("Min Gap",(s.minGapMinutes??"30")+"min")+card("Lock",(s.tickLockTimeout??"90")+"s")+card("Refresh",(s.refreshIntervalMinutes??"15")+"min")+'</div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Slots</h3><div style="display:flex;flex-wrap:wrap;gap:6px">'+(s.slots||[]).map(t=>'<span class="badge badge-blue">'+t+"</span>").join("")+'</div></div>';
}

async function loadLogs(){
  const d=await api("logs");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  const errJson=JSON.stringify(d.errors.slice(0,20),null,2);
  const updJson=JSON.stringify(d.updates.slice(0,20),null,2);
  c.innerHTML='<div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><h3>Errors ('+d.errors.length+')</h3><div><button class="btn btn-danger btn-sm" onclick="clearLogs()">Clear</button></div></div><pre id="err-pre">'+errJson+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement(\\'err-pre\\')">📋 Copy Errors</button></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Updates ('+d.updates.length+')</h3><pre id="upd-pre">'+updJson+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement(\\'upd-pre\\')">📋 Copy Updates</button></div>';
}

async function loadConfig(){
  const d=await api("config");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  const cfgJson=JSON.stringify(d.settings,null,2);
  c.innerHTML='<div class="card"><h3 style="margin-bottom:8px">Config Sections</h3><table><thead><tr><th>Section</th><th>Version</th><th>Description</th></tr></thead><tbody>'+(d.sections||[]).map(s=>'<tr><td><code>'+s.key+'</code></td><td>v'+s.version+'</td><td>'+s.description+'</td></tr>').join("")+'</tbody></table></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Full Config</h3><pre id="cfg-pre">'+cfgJson+'</pre><button class="btn btn-sm btn-ghost" onclick="copyElement(\\'cfg-pre\\')">📋 Copy Config</button></div>';
}

async function loadSystem(){
  const d=await api("system");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div class="card-grid">'+card("Version",d.version)+card("Build",d.buildDate)+card("Runtime",d.runtime)+card("KV",d.kv?"✓":"✗")+card("Plugins",d.pluginCount)+card("Providers",d.providerCount)+card("Cache",d.cacheStats?.size??0)+card("Cache TTL",(d.cacheStats?.ttlMs??0)/1000+"s")+'</div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Secrets</h3>'+Object.entries(d.hasSecrets||{}).map(([k,v])=>'<span class="badge '+(v?"badge-green":"badge-red")+'" style="margin:2px">'+k+": "+(v?"✓":"✗")+"</span>").join(" ")+'</div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Actions</h3><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-danger" onclick="clearDedup()">Clear Dedup</button><button class="btn btn-danger" onclick="clearQueue()">Clear Queue</button><button class="btn btn-ghost" onclick="clearLogs()">Clear Logs</button><button class="btn btn-ghost" onclick="clearSources()">Clear Source Caches</button><button class="btn btn-warning" onclick="clearCache()">Clear Config Cache</button><button class="btn btn-danger" onclick="resetSettings()">⚠️ Reset Settings to Defaults</button></div><div id="sys-result" style="margin-top:12px"></div></div>';
}

async function loadStats(){
  const d=await api("history");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div class="card"><h3 style="margin-bottom:8px">Today ('+d.today.date+')</h3>'+(d.today.entries.length===0?"<p>No posts today.</p>":'<table><thead><tr><th>Time</th><th>Plugin</th><th>Cat</th><th>Score</th><th>Msg ID</th></tr></thead><tbody>'+d.today.entries.map(e=>'<tr><td>'+new Date(e.publishedAt).toLocaleTimeString()+'</td><td>'+e.pluginId+'</td><td>'+e.category+'</td><td>'+e.qualityScore+'</td><td>'+(e.telegramMessageId>0?e.telegramMessageId:"❌")+'</td></tr>').join("")+'</tbody></table>')+'</div>'+
  '<div class="card"><h3>Recent (7 days): '+d.recent.length+' posts</h3></div>';
}

function loadAbout(){
  document.getElementById("content").innerHTML='<div class="card"><h1 style="font-size:24px;margin-bottom:12px">🤖 Fredy</h1><p style="color:var(--text2);margin-bottom:16px">AI-powered Telegram Content Engine</p><div class="card-grid">'+card("Version","4.5.1")+card("License","MIT")+card("Runtime","Cloudflare Workers")+card("Language","TypeScript")+card("AI","Gemini + OpenRouter")+card("Storage","Cloudflare KV")+'</div><p style="color:var(--text2)">Built for the developer community.</p></div>';
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
