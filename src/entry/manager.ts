/**
 * src/entry/manager.ts
 * /Manager — production-grade management dashboard.
 * Modern dark-mode SPA with sidebar navigation.
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

  // Auth check — DEBUG_TOKEN or ADMIN_ID from Telegram.
  if (env.DEBUG_TOKEN) {
    const auth = request.headers.get("Authorization");
    const queryToken = url.searchParams.get("token");
    if (auth !== `Bearer ${env.DEBUG_TOKEN}` && queryToken !== env.DEBUG_TOKEN) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  // GET /Manager — HTML dashboard.
  if (url.pathname === "/Manager" || url.pathname === "/manager") {
    return new Response(managerHTML(env), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // ── API endpoints under /Manager/api/ ──
  const apiPath = url.pathname.replace(/^\/[Mm]anager\/api\//, "");

  // GET /Manager/api/health — system health overview
  if (apiPath === "health" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const stats = await container.kv.getGlobalStats().catch(() => ({ processed: 0, published: 0, rejected: 0, failed: 0 }));
    const state = await container.config.getState(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const schedStatus = await container.scheduler.status().catch(() => null);
    const queueDepths = await container.queue.depth().catch(() => []);
    const lastRefresh = await container.kv.get("fredy:tick:lastRefresh").catch(() => null);
<<<<<<< HEAD
    const lastTick = await container.kv.get("fredy:tick:lastTick").catch(() => null);
    return json({ ok: true, version: "3.3.0", bot: { enabled: settings?.general.botEnabled, maintenance: settings?.general.maintenanceMode }, scheduler: { enabled: settings?.scheduler.enabled, nextSlot: schedStatus?.nextSlot, postsToday: schedStatus?.postsPublishedToday }, approveMode: settings?.approveMode, language: settings?.language.default, aiProvider: settings?.ai.primaryProvider, plugins: { enabled: container.plugins.list().filter(p => container.plugins.isEnabled(p.metadata.id)).length, total: container.plugins.list().length }, categories: { A: settings?.categories.A.enabled, B: settings?.categories.B.enabled, C: settings?.categories.C.enabled }, stats, state, queueDepths, lastRefresh: lastRefresh ? Number(lastRefresh) : null, lastTick: lastTick ? Number(lastTick) : null, hasSecrets: { botToken: !!env.BOT_TOKEN, gemini: !!env.GEMINI_API_KEY, openrouter: !!env.OPENROUTER_API_KEY, newsapi: !!env.NEWSAPI_KEY, nasa: !!env.NASA_API_KEY, github: !!env.GITHUB_TOKEN, cronKey: !!env.CRON_KEY, webhookSecret: !!env.WEBHOOK_SECRET, debugToken: !!env.DEBUG_TOKEN } });
=======
    const lastTick = await container.kv.get("fredy:tick:lock").catch(() => null);
    return json({
      ok: true,
      version: "2.1.0",
      bot: { enabled: settings?.general.botEnabled, maintenance: settings?.general.maintenanceMode },
      scheduler: { enabled: settings?.scheduler.enabled, nextSlot: schedStatus?.nextSlot, postsToday: schedStatus?.postsPublishedToday },
      approveMode: settings?.approveMode,
      language: settings?.language.default,
      aiProvider: settings?.ai.primaryProvider,
      plugins: { enabled: container.plugins.list().filter(p => container.plugins.isEnabled(p.metadata.id)).length, total: container.plugins.list().length },
      categories: { A: settings?.categories.A.enabled, B: settings?.categories.B.enabled, C: settings?.categories.C.enabled },
      stats,
      state,
      queueDepths,
      lastRefresh: lastRefresh ? Number(lastRefresh) : null,
      lastTick: lastTick ? Number(lastTick) : null,
      hasSecrets: { botToken: !!env.BOT_TOKEN, gemini: !!env.GEMINI_API_KEY, openrouter: !!env.OPENROUTER_API_KEY, newsapi: !!env.NEWSAPI_KEY, nasa: !!env.NASA_API_KEY, github: !!env.GITHUB_TOKEN },
    });
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
  }

  // GET /Manager/api/plugins
  if (apiPath === "plugins" && request.method === "GET") {
    const plugins = container.plugins.list().map(p => ({
      id: p.metadata.id, name: p.metadata.name, version: p.metadata.version,
      category: p.metadata.category, priority: p.metadata.priority,
      enabled: container.plugins.isEnabled(p.metadata.id),
      supportsImages: p.metadata.supportsImages, rateLimit: p.metadata.rateLimit,
      homepage: p.metadata.homepage,
    }));
    return json({ ok: true, plugins });
  }

  // GET /Manager/api/queue
  if (apiPath === "queue" && request.method === "GET") {
    const depths = await container.queue.depth().catch(() => []);
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    return json({
      ok: true,
      depths,
      limits: settings ? {
        A: { min: settings.content.queueMinA, target: settings.content.queueTargetA },
        B: { min: settings.content.queueMinB, target: settings.content.queueTargetB },
        C: { min: settings.content.queueMinC, target: settings.content.queueTargetC },
      } : null,
    });
  }

  // GET /Manager/api/ai
  if (apiPath === "ai" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const providers = container.providers.listWithStatus();
    const tokenStats = container.ai.getTokenStats();
    return json({ ok: true, settings: settings?.ai, providers, tokenStats });
  }

  // GET /Manager/api/scheduler
  if (apiPath === "scheduler" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const status = await container.scheduler.status().catch(() => null);
    return json({ ok: true, settings: settings?.scheduler, status });
  }

  // GET /Manager/api/history
  if (apiPath === "history" && request.method === "GET") {
    const today = await container.history.getToday().catch(() => ({ entries: [], total: 0, date: "" }));
    const recent = await container.history.getRecent(7).catch(() => []);
    return json({ ok: true, today, recent });
  }

  // GET /Manager/api/logs
  if (apiPath === "logs" && request.method === "GET") {
    const updates = await container.debug.getRecentUpdates().catch(() => []);
    const errors = await container.debug.getRecentErrors().catch(() => []);
    return json({ ok: true, updates, errors });
  }

  // GET /Manager/api/config
  if (apiPath === "config" && request.method === "GET") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    return json({ ok: true, settings, sections: container.config.listSections() });
  }

  // GET /Manager/api/system
  if (apiPath === "system" && request.method === "GET") {
<<<<<<< HEAD
    return json({ ok: true, version: "3.3.0", buildDate: "2026-07-12", runtime: "cloudflare-workers", kv: !!env.Fredy_SETTINGS, cacheStats: container.config.cacheStats(), pluginCount: container.plugins.list().length, providerCount: container.providers.list().length, hasSecrets: { botToken: !!env.BOT_TOKEN, gemini: !!env.GEMINI_API_KEY, openrouter: !!env.OPENROUTER_API_KEY, cronKey: !!env.CRON_KEY } });
=======
    return json({
      ok: true,
      version: "2.1.0",
      buildDate: "2026-07-05",
      runtime: "cloudflare-workers",
      kv: !!env.Fredy_SETTINGS,
      cacheStats: container.config.cacheStats(),
      pluginCount: container.plugins.list().length,
      providerCount: container.providers.list().length,
      hasSecrets: { botToken: !!env.BOT_TOKEN, gemini: !!env.GEMINI_API_KEY, openrouter: !!env.OPENROUTER_API_KEY },
    });
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
  }

  // POST /Manager/api/test/plugin/:id
  const pluginMatch = apiPath.match(/^test\/plugin\/([\w-]+)$/);
  if (pluginMatch && request.method === "POST") {
    try {
      const items = await container.plugins.fetchFrom(pluginMatch[1]!);
      return json({ ok: true, itemCount: items.length, items: items.slice(0, 3).map(i => ({ id: i.id, title: i.title, url: i.url })) });
    } catch (error) {
      return json({ ok: false, error: errMsg(error) }, 500);
    }
  }

  // POST /Manager/api/test/ai
  if (apiPath === "test/ai" && request.method === "POST") {
    try {
      const body = await request.json().catch(() => ({})) as { text?: string };
      const soul = await container.soul.load();
      const result = await container.ai.generate({
        category: "A", source: "test", raw: { id: "test", source: "test", category: "A" as const, title: "Test", body: body.text ?? "Test about AI", url: "https://example.com", fetchedAt: Date.now() },
        language: "en", soul,
      });
      return json({ ok: result.ok, provider: result.provider, model: result.model, tokens: result.tokensUsed, score: result.quality?.overallScore, text: result.content?.text?.slice(0, 500), error: result.error });
    } catch (error) {
      return json({ ok: false, error: errMsg(error) }, 500);
    }
  }

<<<<<<< HEAD
  // ── Test Everything (comprehensive single-result test) ──
  if (apiPath === "test/everything" && request.method === "POST") {
    const report: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      version: "3.3.0",
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
          version: "3.3.0",
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
      await container.kv.set("fredy:_backtest", "ok", 10);
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
=======
  // POST /Manager/api/clear/logs
  if (apiPath === "clear/logs" && request.method === "POST") {
    await container.debug.clearLogs();
    return json({ ok: true });
  }

  // POST /Manager/api/clear/dedup
  if (apiPath === "clear/dedup" && request.method === "POST") {
    await container.duplicateDetector.clear();
    return json({ ok: true });
  }

  // POST /Manager/api/clear/queue
  if (apiPath === "clear/queue" && request.method === "POST") {
    await container.queue.clearAll();
    return json({ ok: true });
  }
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2

  return new Response("Not Found", { status: 404 });
}

function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

// ────────────────────────────────────────────────────────────
// Manager Dashboard HTML (SPA)
// ────────────────────────────────────────────────────────────

function managerHTML(env: Env): string {
  const token = env.DEBUG_TOKEN ?? "";
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fredy Manager</title>
<style>
:root{--bg:#0a0a0f;--surface:#12121a;--surface2:#1a1a26;--border:#252535;--text:#e0e0ea;--text2:#8888a0;--accent:#6366f1;--accent2:#818cf8;--green:#22c55e;--red:#ef4444;--yellow:#eab308;--blue:#3b82f6;--radius:10px;--sidebar-w:220px}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5;overflow:hidden}
a{color:var(--accent2);text-decoration:none}

/* Sidebar */
.sidebar{position:fixed;left:0;top:0;bottom:0;width:var(--sidebar-w);background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;z-index:100;transition:transform .3s}
.sidebar.collapsed{transform:translateX(calc(-1 * var(--sidebar-w)))}
.sidebar-header{padding:20px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
.sidebar-header h1{font-size:16px;font-weight:700;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sidebar-nav{flex:1;overflow-y:auto;padding:8px}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;color:var(--text2);transition:all .15s;font-size:13px;margin-bottom:2px}
.nav-item:hover{background:var(--surface2);color:var(--text)}
.nav-item.active{background:var(--accent);color:#fff}
.nav-icon{font-size:16px;width:20px;text-align:center}

/* Main */
.main{margin-left:var(--sidebar-w);height:100vh;overflow-y:auto;transition:margin-left .3s}
.main.expanded{margin-left:0}
.topbar{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;gap:12px;z-index:50}
.topbar button{background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;cursor:pointer;font-size:13px}
.topbar h2{font-size:16px;font-weight:600}
.content{padding:24px;max-width:1200px;margin:0 auto}

/* Cards */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:12px}
.card-label{color:var(--text2);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.card-value{font-size:18px;font-weight:600}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px}

/* Table */
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px;color:var(--text2);border-bottom:1px solid var(--border);font-weight:600;font-size:11px;text-transform:uppercase}
td{padding:8px;border-bottom:1px solid var(--border)}
tr:hover td{background:var(--surface2)}

/* Badge */
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}
.badge-green{background:rgba(34,197,94,.15);color:var(--green)}
.badge-red{background:rgba(239,68,68,.15);color:var(--red)}
.badge-yellow{background:rgba(234,179,8,.15);color:var(--yellow)}
.badge-blue{background:rgba(59,130,246,.15);color:var(--blue)}
.badge-gray{background:rgba(136,136,160,.15);color:var(--text2)}

/* Button */
.btn{background:var(--accent);color:#fff;border:none;padding:7px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;transition:all .15s}
.btn:hover{background:var(--accent2)}
.btn-sm{padding:4px 10px;font-size:12px}
.btn-danger{background:var(--red)}
.btn-danger:hover{background:#dc2626}
.btn-ghost{background:var(--surface2);color:var(--text);border:1px solid var(--border)}

/* Toast */
.toast{position:fixed;bottom:20px;right:20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 20px;z-index:1000;animation:slideUp .3s;box-shadow:0 4px 20px rgba(0,0,0,.3)}
@keyframes slideUp{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}

/* Page */
.page{display:none}
.page.active{display:block}

/* Pre */
pre{background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:12px;overflow-x:auto;font-size:12px;max-height:400px;overflow-y:auto;font-family:'SF Mono',Monaco,monospace}

/* Skeleton */
.skeleton{background:var(--surface2);border-radius:6px;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}

/* Responsive */
@media(max-width:768px){:root{--sidebar-w:200px}.sidebar{transform:translateX(calc(-1 * var(--sidebar-w)))}.sidebar.open{transform:translateX(0)}.main{margin-left:0}}
</style>
</head>
<body>

<div class="sidebar" id="sidebar">
  <div class="sidebar-header"><span style="font-size:20px">🤖</span><h1>Fredy</h1></div>
  <div class="sidebar-nav" id="nav"></div>
</div>

<div class="main" id="main">
  <div class="topbar">
    <button onclick="toggleSidebar()" id="menu-btn">☰</button>
    <h2 id="page-title">Dashboard</h2>
    <div style="margin-left:auto;display:flex;gap:8px">
      <button onclick="refresh()" class="btn btn-ghost btn-sm">🔄 Refresh</button>
    </div>
  </div>
  <div class="content" id="content"></div>
</div>

<script>
const TOKEN="${token}";
const API="/Manager/api/";
const navItems=[
  {id:"dashboard",icon:"📊",label:"Dashboard"},
  {id:"content",icon:"📝",label:"Content"},
  {id:"scheduler",icon:"📅",label:"Scheduler"},
  {id:"queue",icon:"📥",label:"Queue"},
  {id:"plugins",icon:"🔌",label:"Plugins"},
  {id:"ai",icon:"🤖",label:"AI"},
  {id:"statistics",icon:"📈",label:"Statistics"},
  {id:"logs",icon:"📜",label:"Logs"},
  {id:"debug",icon:"🐛",label:"Debug"},
  {id:"config",icon:"⚙️",label:"Configuration"},
  {id:"system",icon:"🖥️",label:"System"},
  {id:"about",icon:"ℹ️",label:"About"},
];
let currentPage="dashboard";

// Build sidebar
function buildNav(){const n=document.getElementById("nav");n.innerHTML=navItems.map(i=>'<div class="nav-item" onclick="navigate(\\''+i.id+'\\')" id="nav-'+i.id+'"><span class="nav-icon">'+i.icon+'</span>'+i.label+'</div>').join("");}

function navigate(id){
  currentPage=id;
  document.querySelectorAll(".nav-item").forEach(e=>e.classList.remove("active"));
  const el=document.getElementById("nav-"+id);
  if(el)el.classList.add("active");
  const item=navItems.find(i=>i.id===id);
  document.getElementById("page-title").textContent=item?item.label:"";
  loadPage(id);
}

function toggleSidebar(){document.getElementById("sidebar").classList.toggle("open");}

async function api(path,method="GET",body=null){
  const opts={method,headers:{}};
  if(TOKEN)opts.headers["Authorization"]="Bearer "+TOKEN;
  if(body){opts.headers["Content-Type"]="application/json";opts.body=JSON.stringify(body);}
  const r=await fetch(API+path,opts);
  return r.json();
}

function toast(msg){
  const t=document.createElement("div");
  t.className="toast";t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

function badge(val){return val?'<span class="badge badge-green">ON</span>':'<span class="badge badge-gray">OFF</span>';}
function fmtTime(ts){if(!ts)return"—";const d=new Date(typeof ts==="number"?ts:parseInt(ts));return d.toLocaleTimeString()+" "+d.toLocaleDateString();}
function fmtAgo(ts){if(!ts)return"—";const s=Math.floor((Date.now()-(typeof ts==="number"?ts:parseInt(ts)))/1000);if(s<60)return s+"s ago";if(s<3600)return Math.floor(s/60)+"m ago";return Math.floor(s/3600)+"h ago";}

function loadPage(id){
  const c=document.getElementById("content");
  c.innerHTML='<div class="card">Loading…</div>';
  switch(id){
    case"dashboard":loadDashboard();break;
    case"plugins":loadPlugins();break;
    case"queue":loadQueue();break;
    case"ai":loadAI();break;
    case"scheduler":loadScheduler();break;
    case"logs":loadLogs();break;
    case"config":loadConfig();break;
    case"system":loadSystem();break;
    case"statistics":loadStats();break;
    case"content":loadContent();break;
    case"debug":loadDebug();break;
    case"about":loadAbout();break;
    default:c.innerHTML='<div class="card">Page not found.</div>';
  }
}

async function loadDashboard(){
<<<<<<< HEAD
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

async function loadBacktest(){
=======
  const d=await api("health");
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
  const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error loading health.</div>';return;}
  c.innerHTML='<div class="card-grid">'+
    card("Version",d.version)+
    card("Bot",d.bot?.enabled?badge(1):badge(0))+
    card("Scheduler",d.scheduler?.enabled?badge(1):badge(0))+
    card("Approve Mode",d.approveMode?badge(1):badge(0))+
    card("AI Provider",d.aiProvider??"—")+
    card("Language",d.language??"—")+
    card("Plugins",d.plugins?.enabled+"/"+d.plugins?.total)+
    card("Categories",Object.entries(d.categories||{}).filter(([,v])=>v).length+"/3")+
    card("Posts Today",d.scheduler?.postsToday??0)+
    card("Next Slot",d.scheduler?.nextSlot?.time??"—")+
    card("Last Refresh",fmtAgo(d.lastRefresh))+
    card("Last Tick",d.lastTick?fmtAgo(d.lastTick):"—")+
    "</div>"+
    '<div class="card"><h3 style="margin-bottom:8px">Global Stats</h3>'+
    '<div class="card-grid">'+
    card("Processed",d.stats?.processed??0)+
    card("Published",d.stats?.published??0)+
    card("Rejected",d.stats?.rejected??0)+
    card("Failed",d.stats?.failed??0)+
    "</div></div>"+
    '<div class="card"><h3 style="margin-bottom:8px">Secrets Status</h3>'+
    Object.entries(d.hasSecrets||{}).map(([k,v])=>'<span class="badge '+(v?"badge-green":"badge-red")+'" style="margin:2px">'+k+": "+(v?"✓":"✗")+"</span>").join(" ")+
    "</div>";
}

async function loadPlugins(){
  const d=await api("plugins");
  const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<table><thead><tr><th>ID</th><th>Name</th><th>Cat</th><th>Enabled</th><th>Priority</th><th>Rate Limit</th><th>Test</th></tr></thead><tbody>'+
    d.plugins.map(p=>'<tr><td><code>'+p.id+'</code></td><td>'+p.name+'</td><td>'+p.category+'</td><td>'+badge(p.enabled)+'</td><td>'+p.priority+'</td><td>'+p.rateLimit+'/hr</td><td><button class="btn btn-sm" onclick="testPlugin(\\''+p.id+'\\')">Test</button></td></tr>').join("")+
    "</tbody></table>";
}

async function loadQueue(){
  const d=await api("queue");
  const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  const l=d.limits||{};
  c.innerHTML=d.depths.map(q=>{
    const lim=l[q.category]||{min:0,target:0};
    const pct=lim.target>0?Math.min(100,q.depth/lim.target*100):0;
    return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div><span class="badge badge-blue">Category '+q.category+'</span></div><div>'+q.depth+" / "+lim.target+'</div></div>'+
      '<div style="background:var(--surface2);border-radius:6px;height:8px;overflow:hidden"><div style="background:var(--accent);height:100%;width:'+pct+'%"></div></div>'+
      '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:var(--text2)"><span>Min: '+lim.min+'</span><span>Target: '+lim.target+'</span></div></div>';
  }).join("");
}

async function loadAI(){
  const d=await api("ai");
  const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div class="card-grid">'+
    card("Provider",d.settings?.primaryProvider??"—")+
    card("Fallback",d.settings?.fallbackProvider??"—")+
    card("Temperature",d.settings?.temperature??"—")+
    card("Max Tokens",d.settings?.maxTokens??"—")+
    card("Quality Threshold",d.settings?.qualityThreshold??"—")+
    card("Retry Count",d.settings?.retryCount??"—")+
    "</div>"+
    '<div class="card"><h3 style="margin-bottom:8px">Providers</h3><table><thead><tr><th>Provider</th><th>Enabled</th><th>Configured</th><th>Models</th></tr></thead><tbody>'+
    d.providers.map(p=>'<tr><td>'+p.name+'</td><td>'+badge(p.enabled)+'</td><td>'+(p.configured?"✓":"✗")+'</td><td>'+p.modelCount+'</td></tr>').join("")+
    "</tbody></table></div>"+
    '<div class="card"><h3 style="margin-bottom:8px">Token Usage</h3><div class="card-grid">'+
    card("Total Calls",d.tokenStats?.totalCalls??0)+
    card("Successful",d.tokenStats?.successfulCalls??0)+
    card("Failed",d.tokenStats?.failedCalls??0)+
    card("Total Tokens",d.tokenStats?.totalTokens??0)+
    card("Est. Cost","$"+(d.tokenStats?.totalCost??0).toFixed(4))+
    "</div></div>"+
    '<div class="card"><h3 style="margin-bottom:8px">Test AI</h3><div style="display:flex;gap:8px;margin-bottom:8px"><input type="text" id="ai-test" placeholder="Test text..." style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px"><button class="btn" onclick="testAI()">Test</button></div><pre id="ai-result"></pre></div>';
}

async function loadScheduler(){
  const d=await api("scheduler");
  const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  const s=d.settings||{};const st=d.status||{};
  c.innerHTML='<div class="card-grid">'+
    card("Enabled",st.enabled?badge(1):badge(0))+
    card("Next Slot",st.nextSlot?.time??"—")+
    card("Posts Today",st.postsPublishedToday??0)+
    card("Queue Depth",st.queueDepth??0)+
    card("Timezone",s.timezone??"—")+
    card("Jitter","±"+(s.jitterMinutes??"0")+"min")+
    card("Min Gap",(s.minGapMinutes??"30")+"min")+
    card("Lock Timeout",(s.tickLockTimeout??"90")+"s")+
    card("Refresh Interval",(s.refreshIntervalMinutes??"15")+"min")+
    "</div>"+
    '<div class="card"><h3 style="margin-bottom:8px">Posting Slots</h3><div style="display:flex;flex-wrap:wrap;gap:6px">'+
    (s.slots||[]).map(t=>'<span class="badge badge-blue">'+t+"</span>").join("")+
    "</div></div>";
}

async function loadLogs(){
  const d=await api("logs");
  const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><h3>Errors ('+d.errors.length+')</h3><button class="btn btn-danger btn-sm" onclick="clearLogs()">Clear</button></div><pre>'+JSON.stringify(d.errors.slice(0,20),null,2)+'</pre></div>'+
    '<div class="card"><h3 style="margin-bottom:8px">Updates ('+d.updates.length+')</h3><pre>'+JSON.stringify(d.updates.slice(0,20),null,2)+'</pre></div>';
}

async function loadConfig(){
  const d=await api("config");
  const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div class="card"><h3 style="margin-bottom:8px">Config Sections</h3><table><thead><tr><th>Section</th><th>Version</th><th>Description</th></tr></thead><tbody>'+
    (d.sections||[]).map(s=>'<tr><td><code>'+s.key+'</code></td><td>v'+s.version+'</td><td>'+s.description+'</td></tr>').join("")+
    "</tbody></table></div>"+
    '<div class="card"><h3 style="margin-bottom:8px">Full Config (read-only)</h3><pre>'+JSON.stringify(d.settings,null,2)+'</pre></div>';
}

async function loadSystem(){
  const d=await api("system");
  const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div class="card-grid">'+
    card("Version",d.version)+
    card("Build Date",d.buildDate)+
    card("Runtime",d.runtime)+
    card("KV Bound",d.kv?"✓":"✗")+
    card("Plugins",d.pluginCount)+
    card("Providers",d.providerCount)+
    card("Cache Size",d.cacheStats?.size??0)+
    card("Cache TTL",(d.cacheStats?.ttlMs??0)/1000+"s")+
    "</div>"+
    '<div class="card"><h3 style="margin-bottom:8px">Secrets</h3>'+
    Object.entries(d.hasSecrets||{}).map(([k,v])=>'<span class="badge '+(v?"badge-green":"badge-red")+'" style="margin:2px">'+k+": "+(v?"✓":"✗")+"</span>").join(" ")+
    "</div>"+
    '<div class="card"><h3 style="margin-bottom:8px">Actions</h3><div style="display:flex;gap:8px;flex-wrap:wrap">'+
    '<button class="btn btn-danger" onclick="clearDedup()">Clear Dedup</button>'+
    '<button class="btn btn-danger" onclick="clearQueue()">Clear Queue</button>'+
    '<button class="btn btn-ghost" onclick="clearLogs()">Clear Logs</button>'+
    "</div><pre id="action-result" style="margin-top:12px"></pre></div>";
}

async function loadStats(){
  const d=await api("history");
  const c=document.getElementById("content");
  if(!d.ok){c.innerHTML='<div class="card">Error</div>';return;}
  c.innerHTML='<div class="card"><h3 style="margin-bottom:8px">Today ('+d.today.date+')</h3>'+
    (d.today.entries.length===0?"<p>No posts published today.</p>":'<table><thead><tr><th>Time</th><th>Plugin</th><th>Cat</th><th>Score</th><th>Msg ID</th></tr></thead><tbody>'+
    d.today.entries.map(e=>'<tr><td>'+new Date(e.publishedAt).toLocaleTimeString()+'</td><td>'+e.pluginId+'</td><td>'+e.category+'</td><td>'+e.qualityScore+'</td><td>'+(e.telegramMessageId>0?e.telegramMessageId:"❌")+'</td></tr>').join("")+
    "</tbody></table>")+"</div>"+
    '<div class="card"><h3 style="margin-bottom:8px">Recent (7 days)</h3><p>'+d.recent.length+' posts total</p></div>';
}

function loadContent(){
  document.getElementById("content").innerHTML='<div class="card"><p>Content management — view generated posts, publish, edit, delete.</p><p style="color:var(--text2);margin-top:8px">This page will show queued posts with preview, quality score, and actions.</p></div>';
}

function loadDebug(){
  document.getElementById("content").innerHTML='<div class="card"><h3 style="margin-bottom:8px">Debug Tools</h3><div style="display:flex;gap:8px;flex-wrap:wrap">'+
    '<button class="btn" onclick="testAI()">Test AI</button>'+
    '<button class="btn" onclick="clearDedup()">Clear Dedup</button>'+
    '<button class="btn" onclick="clearQueue()">Clear Queue</button>'+
    '<button class="btn" onclick="clearLogs()">Clear Logs</button>'+
    "</div><pre id='debug-result' style='margin-top:12px'></pre></div>";
}

function loadAbout(){
<<<<<<< HEAD
  document.getElementById("content").innerHTML='<div class="card"><h1 style="font-size:24px;margin-bottom:12px">🤖 Fredy</h1><p style="color:var(--text2);margin-bottom:16px">AI-powered Telegram Content Engine</p><div class="card-grid">'+card("Version","3.3.0")+card("License","MIT")+card("Runtime","Cloudflare Workers")+card("Language","TypeScript")+card("AI","Gemini + OpenRouter")+card("Storage","Cloudflare KV")+'</div><p style="color:var(--text2)">Built for the developer community.</p></div>';
=======
  document.getElementById("content").innerHTML='<div class="card">'+
    '<h1 style="font-size:24px;margin-bottom:12px">🤖 Fredy</h1>'+
    '<p style="color:var(--text2);margin-bottom:16px">AI-powered Telegram Content Engine for Developer Channels</p>'+
    '<div class="card-grid">'+
    card("Version","2.1.0")+
    card("License","MIT")+
    card("Runtime","Cloudflare Workers")+
    card("Language","TypeScript")+
    card("AI","Gemini + OpenRouter")+
    card("Storage","Cloudflare KV")+
    "</div>"+
    '<p style="color:var(--text2)">Built with ❤️ for the developer community.</p>'+
    "</div>";
}

function card(label,value){return '<div class="card"><div class="card-label">'+label+'</div><div class="card-value">'+value+"</div></div>";}

async function testPlugin(id){
  toast("Testing "+id+"...");
  const d=await api("test/plugin/"+id,"POST");
  toast(d.ok?"✅ "+id+": "+d.itemCount+" items":"❌ "+id+": "+d.error);
}

async function testAI(){
  const text=document.getElementById("ai-test")?.value||"Test about Cloudflare Workers";
  const el=document.getElementById("ai-result")||document.getElementById("debug-result");
  if(el)el.textContent="Testing...";
  const d=await api("test/ai","POST",{text});
  if(el)el.textContent=JSON.stringify(d,null,2);
  toast(d.ok?"✅ AI test OK":"❌ AI test failed");
>>>>>>> 338f91d7e1c1bb2b5861cfa5e9e862ca21001df2
}

async function clearLogs(){const d=await api("clear/logs","POST");toast(d.ok?"✅ Logs cleared":"❌ Failed");}
async function clearDedup(){const d=await api("clear/dedup","POST");const el=document.getElementById("action-result")||document.getElementById("debug-result");if(el)el.textContent=JSON.stringify(d,null,2);toast(d.ok?"✅ Dedup cleared":"❌ Failed");}
async function clearQueue(){const d=await api("clear/queue","POST");const el=document.getElementById("action-result")||document.getElementById("debug-result");if(el)el.textContent=JSON.stringify(d,null,2);toast(d.ok?"✅ Queue cleared":"❌ Failed");}

function refresh(){loadPage(currentPage);}

// Init
buildNav();
navigate("dashboard");
setInterval(()=>{if(currentPage==="dashboard")loadDashboard();},30000);
</script>
</body>
</html>`;
}
