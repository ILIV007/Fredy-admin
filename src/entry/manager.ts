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
    return json({ ok: true, version: "2.2.0", bot: { enabled: settings?.general.botEnabled, maintenance: settings?.general.maintenanceMode }, scheduler: { enabled: settings?.scheduler.enabled, nextSlot: schedStatus?.nextSlot, postsToday: schedStatus?.postsPublishedToday }, approveMode: settings?.approveMode, language: settings?.language.default, aiProvider: settings?.ai.primaryProvider, plugins: { enabled: container.plugins.list().filter(p => container.plugins.isEnabled(p.metadata.id)).length, total: container.plugins.list().length }, categories: { A: settings?.categories.A.enabled, B: settings?.categories.B.enabled, C: settings?.categories.C.enabled }, stats, state, queueDepths, lastRefresh: lastRefresh ? Number(lastRefresh) : null, hasSecrets: { botToken: !!env.BOT_TOKEN, gemini: !!env.GEMINI_API_KEY, openrouter: !!env.OPENROUTER_API_KEY, newsapi: !!env.NEWSAPI_KEY, nasa: !!env.NASA_API_KEY, github: !!env.GITHUB_TOKEN, cronKey: !!env.CRON_KEY, webhookSecret: !!env.WEBHOOK_SECRET, debugToken: !!env.DEBUG_TOKEN } });
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
      await container.kv.set("fredy:_backtest", "ok", 10);
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
    return json({ ok: true, settings: settings?.ai, providers, tokenStats });
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
    return json({ ok: true, version: "2.2.0", buildDate: "2026-07-05", runtime: "cloudflare-workers", kv: !!env.Fredy_SETTINGS, cacheStats: container.config.cacheStats(), pluginCount: container.plugins.list().length, providerCount: container.providers.list().length, hasSecrets: { botToken: !!env.BOT_TOKEN, gemini: !!env.GEMINI_API_KEY, openrouter: !!env.OPENROUTER_API_KEY, cronKey: !!env.CRON_KEY } });
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

  // ── Clear actions ──
  if (apiPath === "clear/logs" && request.method === "POST") { await container.debug.clearLogs(); return json({ ok: true }); }
  if (apiPath === "clear/dedup" && request.method === "POST") { await container.duplicateDetector.clear(); return json({ ok: true }); }
  if (apiPath === "clear/queue" && request.method === "POST") { await container.queue.clearAll(); return json({ ok: true }); }

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
const navItems=[{id:"dashboard",icon:"📊",label:"Dashboard"},{id:"backtest",icon:"🧪",label:"Back-Test"},{id:"plugins",icon:"🔌",label:"Plugins"},{id:"queue",icon:"📥",label:"Queue"},{id:"ai",icon:"🤖",label:"AI"},{id:"scheduler",icon:"📅",label:"Scheduler"},{id:"statistics",icon:"📈",label:"Statistics"},{id:"logs",icon:"📜",label:"Logs"},{id:"config",icon:"⚙️",label:"Configuration"},{id:"system",icon:"🖥️",label:"System"},{id:"about",icon:"ℹ️",label:"About"}];
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
function loadPage(id){const c=document.getElementById("content");c.innerHTML='<div class="card">Loading…</div>';({dashboard:loadDashboard,backtest:loadBacktest,plugins:loadPlugins,queue:loadQueue,ai:loadAI,scheduler:loadScheduler,logs:loadLogs,config:loadConfig,system:loadSystem,statistics:loadStats,about:loadAbout}[id]||(()=>c.innerHTML='<div class="card">Page not found.</div>'))();}

async function loadDashboard(){
  const d=await api("health");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div class="card-grid">'+card("Version",d.version)+card("Bot",d.bot?.enabled?badge(1):badge(0))+card("Scheduler",d.scheduler?.enabled?badge(1):badge(0))+card("Approve",d.approveMode?badge(1):badge(0))+card("AI",d.aiProvider??"—")+card("Language",d.language??"—")+card("Plugins",d.plugins?.enabled+"/"+d.plugins?.total)+card("Posts Today",d.scheduler?.postsToday??0)+card("Next Slot",d.scheduler?.nextSlot?.time??"—")+card("Last Refresh",fmtAgo(d.lastRefresh))+card("Last Tick",d.lastTick?fmtAgo(d.lastTick):"—")+'</div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Global Stats</h3><div class="card-grid">'+card("Processed",d.stats?.processed??0)+card("Published",d.stats?.published??0)+card("Rejected",d.stats?.rejected??0)+card("Failed",d.stats?.failed??0)+'</div></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Secrets</h3>'+Object.entries(d.hasSecrets||{}).map(([k,v])=>'<span class="badge '+(v?"badge-green":"badge-red")+'" style="margin:2px">'+k+": "+(v?"✓":"✗")+"</span>").join(" ")+'</div>';
}

async function loadBacktest(){
  const c=document.getElementById("content");
  c.innerHTML='<div class="card"><h3 style="margin-bottom:8px">🧪 Full System Back-Test</h3><p style="color:var(--text2);margin-bottom:12px">Runs all system tests: KV, Config, Telegram, AI, Plugins, Queue, Scheduler, History, Secrets.</p><button class="btn" onclick="runBacktest()">▶️ Run Back-Test</button></div><div id="backtest-results"></div>';
}
async function runBacktest(){
  const r=document.getElementById("backtest-results");r.innerHTML='<div class="card">Running tests…</div>';
  const d=await api("backtest","POST");
  r.innerHTML='<div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><h3>'+(d.ok?'✅ All Tests Passed':'❌ Some Tests Failed')+'</h3><span class="badge '+(d.ok?"badge-green":"badge-red")+'">'+d.summary+'</span></div></div>'+
  d.results.map(t=>'<div class="test-result '+(t.ok?"test-pass":"test-fail")+'"><span>'+(t.ok?"✅":"❌")+'</span><span style="font-weight:600">'+t.test+'</span><span style="color:var(--text2);flex:1">'+t.detail+'</span><span style="color:var(--text2);font-size:11px">'+t.durationMs+'ms</span><button class="btn btn-sm btn-ghost" onclick="copyText(\\''+t.test+": "+t.detail+'\\')">📋</button></div>').join("");
  toast(d.ok?"✅ All tests passed!":"❌ Some tests failed");
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
  c.innerHTML='<div class="card-grid">'+card("Provider",d.settings?.primaryProvider??"—")+card("Fallback",d.settings?.fallbackProvider??"—")+card("Temperature",d.settings?.temperature??"—")+card("Max Tokens",d.settings?.maxTokens??"—")+card("Quality",d.settings?.qualityThreshold??"—")+card("Retries",d.settings?.retryCount??"—")+'</div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Providers</h3><table><thead><tr><th>Provider</th><th>Enabled</th><th>Configured</th><th>Models</th></tr></thead><tbody>'+d.providers.map(p=>'<tr><td>'+p.name+'</td><td>'+badge(p.enabled)+'</td><td>'+(p.configured?"✓":"✗")+'</td><td>'+p.modelCount+'</td></tr>').join("")+'</tbody></table></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Token Usage</h3><div class="card-grid">'+card("Calls",d.tokenStats?.totalCalls??0)+card("Success",d.tokenStats?.successfulCalls??0)+card("Failed",d.tokenStats?.failedCalls??0)+card("Tokens",d.tokenStats?.totalTokens??0)+card("Cost","$"+(d.tokenStats?.totalCost??0).toFixed(4))+'</div></div>'+
  '<div class="card"><h3 style="margin-bottom:8px">Test AI</h3><div style="display:flex;gap:8px;margin-bottom:8px"><input type="text" id="ai-test" placeholder="Test text..." style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px"><button class="btn" onclick="testAI()">Test</button></div><div id="ai-result-wrap"></div></div>';
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
  '<div class="card"><h3 style="margin-bottom:8px">Actions</h3><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-danger" onclick="clearDedup()">Clear Dedup</button><button class="btn btn-danger" onclick="clearQueue()">Clear Queue</button><button class="btn btn-ghost" onclick="clearLogs()">Clear Logs</button></div><div id="sys-result" style="margin-top:12px"></div></div>';
}

async function loadStats(){
  const d=await api("history");const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div class="card"><h3 style="margin-bottom:8px">Today ('+d.today.date+')</h3>'+(d.today.entries.length===0?"<p>No posts today.</p>":'<table><thead><tr><th>Time</th><th>Plugin</th><th>Cat</th><th>Score</th><th>Msg ID</th></tr></thead><tbody>'+d.today.entries.map(e=>'<tr><td>'+new Date(e.publishedAt).toLocaleTimeString()+'</td><td>'+e.pluginId+'</td><td>'+e.category+'</td><td>'+e.qualityScore+'</td><td>'+(e.telegramMessageId>0?e.telegramMessageId:"❌")+'</td></tr>').join("")+'</tbody></table>')+'</div>'+
  '<div class="card"><h3>Recent (7 days): '+d.recent.length+' posts</h3></div>';
}

function loadAbout(){
  document.getElementById("content").innerHTML='<div class="card"><h1 style="font-size:24px;margin-bottom:12px">🤖 Fredy</h1><p style="color:var(--text2);margin-bottom:16px">AI-powered Telegram Content Engine</p><div class="card-grid">'+card("Version","2.2.0")+card("License","MIT")+card("Runtime","Cloudflare Workers")+card("Language","TypeScript")+card("AI","Gemini + OpenRouter")+card("Storage","Cloudflare KV")+'</div><p style="color:var(--text2)">Built for the developer community.</p></div>';
}

async function clearLogs(){const d=await api("clear/logs","POST");toast(d.ok?"✅ Logs cleared":"❌ Failed");}
async function clearDedup(){const d=await api("clear/dedup","POST");const el=document.getElementById("sys-result");if(el)el.innerHTML=preWithCopy("dedup-r",JSON.stringify(d,null,2));toast(d.ok?"✅ Dedup cleared":"❌ Failed");}
async function clearQueue(){const d=await api("clear/queue","POST");const el=document.getElementById("sys-result");if(el)el.innerHTML=preWithCopy("queue-r",JSON.stringify(d,null,2));toast(d.ok?"✅ Queue cleared":"❌ Failed");}
function refresh(){loadPage(currentPage);}
buildNav();navigate("dashboard");setInterval(()=>{if(currentPage==="dashboard")loadDashboard();},30000);
</script></body></html>`;
}
