/**
 * src/entry/manager.ts
 * /Manager — full debug dashboard with tests, logs, health, API tests.
 *
 * Features:
 *   - System health overview
 *   - Plugin status (all 12 plugins)
 *   - AI provider test
 *   - Content source test (fetch from any plugin)
 *   - Recent logs (updates, errors, raw requests)
 *   - KV browser
 *   - Scheduler status
 *   - Queue depths
 *   - History (today + recent)
 *   - Pipeline simulation
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

  // Auth check.
  if (env.DEBUG_TOKEN) {
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.DEBUG_TOKEN}`) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  // GET /Manager — HTML dashboard.
  if (request.method === "GET" && (url.pathname === "/Manager" || url.pathname === "/manager")) {
    return new Response(managerHTML(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // ── API endpoints ──

  // GET /Manager/api/health
  if (request.method === "GET" && url.pathname === "/Manager/api/health") {
    const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0")).catch(() => null);
    const stats = await container.kv.getGlobalStats().catch(() => ({ processed: 0, published: 0, rejected: 0, failed: 0 }));
    return json({ ok: true, version: "1.9.0", settings: settings ? { botEnabled: settings.general.botEnabled, schedulerEnabled: settings.scheduler.enabled, approveMode: settings.approveMode } : null, stats });
  }

  // GET /Manager/api/plugins
  if (request.method === "GET" && url.pathname === "/Manager/api/plugins") {
    const plugins = container.plugins.list().map((p) => ({
      id: p.metadata.id, name: p.metadata.name, category: p.metadata.category,
      enabled: container.plugins.isEnabled(p.metadata.id),
      priority: p.metadata.priority, supportsImages: p.metadata.supportsImages,
    }));
    const statuses = container.plugins.getAllStatuses();
    return json({ ok: true, plugins, statuses });
  }

  // GET /Manager/api/providers
  if (request.method === "GET" && url.pathname === "/Manager/api/providers") {
    const providers = container.providers.listWithStatus();
    const tokenStats = container.ai.getTokenStats();
    return json({ ok: true, providers, tokenStats });
  }

  // GET /Manager/api/scheduler
  if (request.method === "GET" && url.pathname === "/Manager/api/scheduler") {
    const status = await container.scheduler.status().catch(() => null);
    const queueDepths = await container.queue.depth().catch(() => []);
    return json({ ok: true, status, queueDepths });
  }

  // GET /Manager/api/history
  if (request.method === "GET" && url.pathname === "/Manager/api/history") {
    const today = await container.history.getToday().catch(() => ({ entries: [], total: 0, date: "" }));
    const recent = await container.history.getRecent(3).catch(() => []);
    return json({ ok: true, today, recent });
  }

  // GET /Manager/api/logs
  if (request.method === "GET" && url.pathname === "/Manager/api/logs") {
    const updates = await container.debug.getRecentUpdates().catch(() => []);
    const errors = await container.debug.getRecentErrors().catch(() => []);
    return json({ ok: true, updates, errors });
  }

  // POST /Manager/api/test/plugin/:id
  const pluginMatch = url.pathname.match(/^\/Manager\/api\/test\/plugin\/([\w-]+)$/);
  if (pluginMatch && request.method === "POST") {
    const pluginId = pluginMatch[1]!;
    try {
      const items = await container.plugins.fetchFrom(pluginId);
      return json({ ok: true, pluginId, itemCount: items.length, items: items.slice(0, 3) });
    } catch (error) {
      return json({ ok: false, pluginId, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  // POST /Manager/api/test/ai
  if (request.method === "POST" && url.pathname === "/Manager/api/test/ai") {
    try {
      const body = await request.json().catch(() => ({})) as { text?: string };
      const testText = body.text ?? "Test post about Cloudflare Workers.";
      const settings = await container.config.getSettings(Number(env.ADMIN_ID ?? "0"));
      const soul = await container.soul.load();
      const result = await container.ai.generate({
        category: "A", source: "test", raw: { id: "test", source: "test", category: "A", title: "Test", body: testText, url: "https://example.com", fetchedAt: Date.now() },
        language: "en", soul,
      });
      return json({ ok: result.ok, provider: result.provider, model: result.model, tokensUsed: result.tokensUsed, score: result.quality?.overallScore, text: result.content?.text?.slice(0, 500), error: result.error });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  // POST /Manager/api/test/pipeline
  if (request.method === "POST" && url.pathname === "/Manager/api/test/pipeline") {
    try {
      const body = await request.json().catch(() => ({})) as { pluginId?: string };
      const pluginId = body.pluginId ?? "github";
      const item = await container.plugins.fetchOne(pluginId);
      if (!item) return json({ ok: false, error: `No content from "${pluginId}"` });
      const result = await container.content.process(item, "en");
      return json({ ok: result.ok, stage: result.stage, error: result.error, rejectedReason: result.rejectedReason, content: result.content ? { id: result.content.id, category: result.content.category, score: result.content.quality.overallScore, textPreview: result.content.text.slice(0, 300) } : null });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  // POST /Manager/api/clear/logs
  if (request.method === "POST" && url.pathname === "/Manager/api/clear/logs") {
    await container.debug.clearLogs();
    return json({ ok: true, message: "Logs cleared" });
  }

  // POST /Manager/api/clear/dedup
  if (request.method === "POST" && url.pathname === "/Manager/api/clear/dedup") {
    await container.duplicateDetector.clear();
    return json({ ok: true, message: "Dedup store cleared" });
  }

  // POST /Manager/api/clear/queue
  if (request.method === "POST" && url.pathname === "/Manager/api/clear/queue") {
    await container.queue.clearAll();
    return json({ ok: true, message: "Queue cleared" });
  }

  return new Response("Not Found", { status: 404 });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function managerHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fredy Manager — Debug Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Roboto, -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; padding: 16px; }
    h1 { color: #58a6ff; margin-bottom: 4px; font-size: 24px; }
    h2 { color: #79c0ff; margin: 20px 0 8px; font-size: 18px; border-bottom: 1px solid #30363d; padding-bottom: 4px; }
    .sub { color: #8b949e; margin-bottom: 16px; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-bottom: 12px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; }
    .card-label { color: #8b949e; font-size: 11px; text-transform: uppercase; margin-bottom: 4px; }
    .card-value { color: #e6edf3; font-family: monospace; font-size: 14px; word-break: break-all; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .badge-ok { background: #1f6f3b; color: #fff; }
    .badge-err { background: #da3633; color: #fff; }
    .badge-warn { background: #d29922; color: #fff; }
    .badge-off { background: #484f58; color: #8b949e; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 13px; }
    th { text-align: left; padding: 6px; color: #8b949e; border-bottom: 1px solid #30363d; }
    td { padding: 6px; border-bottom: 1px solid #21262d; }
    tr:hover { background: #161b22; }
    button { background: #238636; color: #fff; border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; margin: 2px; }
    button:hover { background: #2ea043; }
    button.danger { background: #da3633; }
    button.danger:hover { background: #f85149; }
    button.blue { background: #1f6feb; }
    button.blue:hover { background: #388bfd; }
    pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px; overflow-x: auto; font-size: 12px; max-height: 300px; overflow-y: auto; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .tabs { display: flex; gap: 4px; margin-bottom: 12px; flex-wrap: wrap; }
    .tab { padding: 6px 16px; border-radius: 6px 6px 0 0; cursor: pointer; background: #161b22; border: 1px solid #30363d; border-bottom: none; font-size: 13px; }
    .tab.active { background: #238636; color: #fff; }
    .panel { display: none; }
    .panel.active { display: block; }
    input[type="text"] { background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 10px; border-radius: 4px; font-size: 13px; width: 200px; }
  </style>
</head>
<body>
  <h1>🔧 Fredy Manager</h1>
  <p class="sub">Complete debug dashboard — health, plugins, AI, pipeline, logs, scheduler, history</p>

  <div class="tabs">
    <div class="tab active" onclick="showTab('health')">Health</div>
    <div class="tab" onclick="showTab('plugins')">Plugins</div>
    <div class="tab" onclick="showTab('ai')">AI</div>
    <div class="tab" onclick="showTab('pipeline')">Pipeline</div>
    <div class="tab" onclick="showTab('scheduler')">Scheduler</div>
    <div class="tab" onclick="showTab('logs')">Logs</div>
    <div class="tab" onclick="showTab('history')">History</div>
    <div class="tab" onclick="showTab('actions')">Actions</div>
  </div>

  <!-- Health -->
  <div id="health" class="panel active">
    <h2>System Health</h2>
    <div id="health-grid" class="grid"><div class="card"><div class="card-label">Loading…</div></div></div>
  </div>

  <!-- Plugins -->
  <div id="plugins" class="panel">
    <h2>Content Source Plugins</h2>
    <table id="plugins-table"><thead><tr><th>ID</th><th>Name</th><th>Cat</th><th>Enabled</th><th>Test</th></tr></thead><tbody></tbody></table>
  </div>

  <!-- AI -->
  <div id="ai" class="panel">
    <h2>AI Providers</h2>
    <div id="ai-info"></div>
    <h2>Test AI Generation</h2>
    <div class="row"><input type="text" id="ai-test-text" value="Test post about Cloudflare Workers." /><button onclick="testAI()">🤖 Test AI</button></div>
    <pre id="ai-result">Click test to see result…</pre>
  </div>

  <!-- Pipeline -->
  <div id="pipeline" class="panel">
    <h2>Pipeline Test</h2>
    <div class="row">
      <select id="pipeline-plugin" style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px;border-radius:4px;font-size:13px;"></select>
      <button onclick="testPipeline()">▶️ Run Pipeline</button>
    </div>
    <pre id="pipeline-result">Click run to see result…</pre>
  </div>

  <!-- Scheduler -->
  <div id="scheduler" class="panel">
    <h2>Scheduler Status</h2>
    <div id="scheduler-info">Loading…</div>
  </div>

  <!-- Logs -->
  <div id="logs" class="panel">
    <h2>Recent Logs</h2>
    <button onclick="loadLogs()">🔄 Refresh</button>
    <h3>Updates</h3>
    <pre id="logs-updates">Loading…</pre>
    <h3>Errors</h3>
    <pre id="logs-errors">Loading…</pre>
  </div>

  <!-- History -->
  <div id="history" class="panel">
    <h2>Today's Published Posts</h2>
    <div id="history-today">Loading…</div>
  </div>

  <!-- Actions -->
  <div id="actions" class="panel">
    <h2>System Actions</h2>
    <div class="row">
      <button class="danger" onclick="clearLogs()">🗑️ Clear Logs</button>
      <button class="danger" onclick="clearDedup()">🗑️ Clear Dedup Store</button>
      <button class="danger" onclick="clearQueue()">🗑️ Clear Queue</button>
    </div>
    <pre id="action-result"></pre>
  </div>

  <script>
    function showTab(id) {
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById(id).classList.add('active');
      event.target.classList.add('active');
      if (id === 'health') loadHealth();
      if (id === 'plugins') loadPlugins();
      if (id === 'ai') loadAI();
      if (id === 'pipeline') loadPipelinePlugins();
      if (id === 'scheduler') loadScheduler();
      if (id === 'logs') loadLogs();
      if (id === 'history') loadHistory();
    }

    async function api(path, method = 'GET', body = null) {
      const opts = { method, headers: {} };
      if (window.DEBUG_TOKEN) opts.headers['Authorization'] = 'Bearer ' + window.DEBUG_TOKEN;
      if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
      const r = await fetch(path, opts);
      return r.json();
    }

    async function loadHealth() {
      const d = await api('/Manager/api/health');
      const g = document.getElementById('health-grid');
      g.innerHTML = '';
      const s = d.settings || {};
      const items = {
        'Version': d.version, 'Bot Enabled': s.botEnabled ? '✅' : '❌', 'Scheduler': s.schedulerEnabled ? '✅' : '❌',
        'Approve Mode': s.approveMode ? '✅' : '❌',
        'Processed': d.stats?.processed, 'Published': d.stats?.published, 'Rejected': d.stats?.rejected, 'Failed': d.stats?.failed,
      };
      for (const [k,v] of Object.entries(items)) {
        g.innerHTML += '<div class="card"><div class="card-label">'+k+'</div><div class="card-value">'+v+'</div></div>';
      }
    }

    async function loadPlugins() {
      const d = await api('/Manager/api/plugins');
      const tb = document.querySelector('#plugins-table tbody');
      tb.innerHTML = '';
      for (const p of d.plugins) {
        const cls = p.enabled ? 'badge-ok' : 'badge-off';
        const txt = p.enabled ? 'ON' : 'OFF';
        tb.innerHTML += '<tr><td>'+p.id+'</td><td>'+p.name+'</td><td>'+p.category+'</td><td><span class="badge '+cls+'">'+txt+'</span></td><td><button onclick="testPlugin(\\''+p.id+'\\')">Test</button></td></tr>';
      }
    }

    async function testPlugin(id) {
      const d = await api('/Manager/api/test/plugin/'+id, 'POST');
      alert(d.ok ? '✅ '+id+': '+d.itemCount+' items' : '❌ '+id+': '+d.error);
    }

    async function loadAI() {
      const d = await api('/Manager/api/providers');
      const el = document.getElementById('ai-info');
      el.innerHTML = '<table><tr><th>Provider</th><th>Enabled</th><th>Models</th><th>Calls</th><th>Tokens</th></tr>';
      for (const p of d.providers) {
        el.innerHTML += '<tr><td>'+p.name+'</td><td>'+(p.enabled?'✅':'❌')+'</td><td>'+p.modelCount+'</td><td>'+(d.tokenStats.byProvider[p.id]?.calls||0)+'</td><td>'+(d.tokenStats.byProvider[p.id]?.tokens||0)+'</td></tr>';
      }
      el.innerHTML += '</table>';
    }

    async function testAI() {
      const text = document.getElementById('ai-test-text').value;
      const d = await api('/Manager/api/test/ai', 'POST', { text });
      document.getElementById('ai-result').textContent = JSON.stringify(d, null, 2);
    }

    async function loadPipelinePlugins() {
      const d = await api('/Manager/api/plugins');
      const sel = document.getElementById('pipeline-plugin');
      sel.innerHTML = '';
      for (const p of d.plugins) {
        if (p.enabled) sel.innerHTML += '<option value="'+p.id+'">'+p.name+'</option>';
      }
    }

    async function testPipeline() {
      const pluginId = document.getElementById('pipeline-plugin').value;
      const d = await api('/Manager/api/test/pipeline', 'POST', { pluginId });
      document.getElementById('pipeline-result').textContent = JSON.stringify(d, null, 2);
    }

    async function loadScheduler() {
      const d = await api('/Manager/api/scheduler');
      const s = d.status || {};
      const el = document.getElementById('scheduler-info');
      el.innerHTML = '<div class="grid">' +
        '<div class="card"><div class="card-label">Enabled</div><div class="card-value">'+(s.enabled?'✅':'❌')+'</div></div>' +
        '<div class="card"><div class="card-label">Next Slot</div><div class="card-value">'+(s.nextSlot?s.nextSlot.time:'—')+'</div></div>' +
        '<div class="card"><div class="card-label">Queue Depth</div><div class="card-value">'+s.queueDepth+'</div></div>' +
        '<div class="card"><div class="card-label">Published Today</div><div class="card-value">'+s.postsPublishedToday+'</div></div>' +
        '</div>';
      if (d.queueDepths) {
        el.innerHTML += '<table><tr><th>Category</th><th>Depth</th></tr>';
        for (const q of d.queueDepths) el.innerHTML += '<tr><td>'+q.category+'</td><td>'+q.depth+'</td></tr>';
        el.innerHTML += '</table>';
      }
    }

    async function loadLogs() {
      const d = await api('/Manager/api/logs');
      document.getElementById('logs-updates').textContent = JSON.stringify(d.updates, null, 2);
      document.getElementById('logs-errors').textContent = JSON.stringify(d.errors, null, 2);
    }

    async function loadHistory() {
      const d = await api('/Manager/api/history');
      const el = document.getElementById('history-today');
      if (!d.today || d.today.entries.length === 0) { el.innerHTML = '<p>No posts published today.</p>'; return; }
      el.innerHTML = '<table><tr><th>Time</th><th>Plugin</th><th>Cat</th><th>Score</th><th>Msg ID</th></tr>';
      for (const e of d.today.entries) {
        el.innerHTML += '<tr><td>'+new Date(e.publishedAt).toLocaleTimeString()+'</td><td>'+e.pluginId+'</td><td>'+e.category+'</td><td>'+e.qualityScore+'</td><td>'+(e.telegramMessageId>0?e.telegramMessageId:'❌')+'</td></tr>';
      }
      el.innerHTML += '</table>';
    }

    async function clearLogs() { const d = await api('/Manager/api/clear/logs', 'POST'); document.getElementById('action-result').textContent = JSON.stringify(d, null, 2); }
    async function clearDedup() { const d = await api('/Manager/api/clear/dedup', 'POST'); document.getElementById('action-result').textContent = JSON.stringify(d, null, 2); }
    async function clearQueue() { const d = await api('/Manager/api/clear/queue', 'POST'); document.getElementById('action-result').textContent = JSON.stringify(d, null, 2); }

    // Auto-load health on start.
    loadHealth();
  </script>
</body>
</html>`;
}
