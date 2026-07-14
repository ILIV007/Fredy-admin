/**
 * src/entry/debug.ts
 * /debug/* routes — debug dashboard HTML page and test API endpoints.
 *
 * Pattern inherited from AI Admin src/index.js handleDebugRoute (lines 474-639),
 * extended with pluggable test endpoints via DebugService.registerTest().
 *
 * All routes require DEBUG_TOKEN auth (if configured). When DEBUG_TOKEN is not
 * set, the dashboard is open — useful for local dev, dangerous for production.
 *
 * See ARCHITECTURE_RULES.md §11.
 */

import type { Container, Env } from "../types/env";
import { processScheduledQueue } from "./cron";

export interface DebugHandlerDeps {
  readonly env: Env;
  readonly container: Container;
}

export async function debugHandler(
  request: Request,
  url: URL,
  deps: DebugHandlerDeps,
): Promise<Response> {
  const { env, container } = deps;

  // Auth check — require Bearer token if DEBUG_TOKEN is set.
  if (env.DEBUG_TOKEN) {
    const auth = request.headers.get("Authorization");
    const expected = `Bearer ${env.DEBUG_TOKEN}`;
    if (auth !== expected) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  // ────────────────────────────────────────────────────────────
  // GET /debug — HTML dashboard
  // ────────────────────────────────────────────────────────────
  if (request.method === "GET" && url.pathname === "/debug") {
    return new Response(debugDashboardHtml(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // ────────────────────────────────────────────────────────────
  // GET /debug/api/ping — liveness
  // ────────────────────────────────────────────────────────────
  if (request.method === "GET" && url.pathname === "/debug/api/ping") {
    const result = await container.debug.ping();
    return json(result);
  }

  // ────────────────────────────────────────────────────────────
  // GET /debug/api/status — env introspection (masked)
  // ────────────────────────────────────────────────────────────
  if (request.method === "GET" && url.pathname === "/debug/api/status") {
    try {
      const status = await container.debug.getStatus();
      return json(status);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // GET /debug/api/tests — list registered tests
  // ────────────────────────────────────────────────────────────
  if (request.method === "GET" && url.pathname === "/debug/api/tests") {
    const tests = container.debug.listTests().map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description,
    }));
    return json({ ok: true, count: tests.length, tests });
  }

  // ────────────────────────────────────────────────────────────
  // GET /debug/api/logs/updates — recent info events
  // ────────────────────────────────────────────────────────────
  if (request.method === "GET" && url.pathname === "/debug/api/logs/updates") {
    const events = await container.debug.getRecentUpdates();
    return json({ ok: true, count: events.length, events });
  }

  // ────────────────────────────────────────────────────────────
  // GET /debug/api/logs/errors — recent errors
  // ────────────────────────────────────────────────────────────
  if (request.method === "GET" && url.pathname === "/debug/api/logs/errors") {
    const events = await container.debug.getRecentErrors();
    return json({ ok: true, count: events.length, events });
  }

  // ────────────────────────────────────────────────────────────
  // GET /debug/api/logs/raw — recent raw webhook requests
  // ────────────────────────────────────────────────────────────
  if (request.method === "GET" && url.pathname === "/debug/api/logs/raw") {
    const events = await container.debug.getRecentRawRequests();
    return json({ ok: true, count: events.length, events });
  }

  // ────────────────────────────────────────────────────────────
  // POST /debug/api/clear — clear all debug logs
  // ────────────────────────────────────────────────────────────
  if (request.method === "POST" && url.pathname === "/debug/api/clear") {
    await container.debug.clearLogs();
    return json({ ok: true, message: "Debug logs cleared" });
  }

  // ────────────────────────────────────────────────────────────
  // POST /debug/api/test/kv — KV round-trip test
  // ────────────────────────────────────────────────────────────
  if (request.method === "POST" && url.pathname === "/debug/api/test/kv") {
    try {
      const result = await container.debug.testKv();
      return json(result);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // POST /debug/api/test/message — send a test Telegram message
  // Body: { chatId: number|string, message: string }
  // ────────────────────────────────────────────────────────────
  if (request.method === "POST" && url.pathname === "/debug/api/test/message") {
    try {
      const body = (await request.json().catch(() => ({}))) as { chatId?: number | string; message?: string };
      const chatId = body.chatId ?? env.ADMIN_ID;
      const message = body.message ?? `🧪 Fredy test message at ${new Date().toISOString()}`;
      const result = await container.debug.testTelegramMessage(chatId, message);
      return json(result);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // POST /debug/api/test/cron — manually trigger the cron queue
  // ────────────────────────────────────────────────────────────
  if (request.method === "POST" && url.pathname === "/debug/api/test/cron") {
    try {
      await processScheduledQueue(env, container);
      return json({ ok: true, message: "Cron queue processed. Check logs for details." });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // POST /debug/api/test/:name — run a registered test
  // ────────────────────────────────────────────────────────────
  const testMatch = url.pathname.match(/^\/debug\/api\/test\/([\w-]+)$/);
  if (testMatch && request.method === "POST") {
    const testName = testMatch[1]!;
    // Skip if it's a built-in test (already handled above).
    if (testName === "kv" || testName === "message" || testName === "cron") {
      return new Response("Not Found", { status: 404 });
    }
    try {
      const result = await container.debug.runTest(testName);
      return json({ ok: true, test: testName, result });
    } catch (error) {
      return json(
        { ok: false, test: testName, error: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // 404
  // ────────────────────────────────────────────────────────────
  return new Response("Not Found", { status: 404 });
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function debugDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fredy — Debug Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117; color: #c9d1d9; padding: 24px; line-height: 1.6;
    }
    h1 { color: #58a6ff; margin-bottom: 8px; }
    h2 { color: #79c0ff; margin: 24px 0 12px; }
    .subtitle { color: #8b949e; margin-bottom: 24px; }
    .grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px; margin-bottom: 24px;
    }
    .card {
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      padding: 16px;
    }
    .card-label { color: #8b949e; font-size: 12px; text-transform: uppercase; margin-bottom: 4px; }
    .card-value { color: #c9d1d9; font-family: 'SF Mono', monospace; word-break: break-all; }
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 12px;
      font-size: 11px; font-weight: 600;
    }
    .badge-ok { background: #1f6f3b; color: #fff; }
    .badge-error { background: #da3633; color: #fff; }
    .badge-warn { background: #d29922; color: #fff; }
    button {
      background: #238636; color: #fff; border: none; border-radius: 6px;
      padding: 8px 16px; cursor: pointer; font-size: 14px; margin: 4px 0;
    }
    button:hover { background: #2ea043; }
    button.danger { background: #da3633; }
    button.danger:hover { background: #f85149; }
    pre {
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      padding: 12px; overflow-x: auto; font-size: 12px; max-height: 400px;
    }
    .endpoint {
      font-family: 'SF Mono', monospace; color: #79c0ff;
      background: #161b22; padding: 2px 6px; border-radius: 3px;
    }
  </style>
</head>
<body>
  <h1>🐛 Fredy Debug Dashboard</h1>
  <p class="subtitle">v5.8.0 — Cloudflare Core</p>

  <h2>Status</h2>
  <div id="status" class="grid"><div class="card"><div class="card-label">Loading…</div></div></div>

  <h2>Quick Tests</h2>
  <button onclick="runTest('ping')">Ping</button>
  <button onclick="runTest('kv')">KV Round-trip</button>
  <button onclick="runTest('cron')">Trigger Cron Queue</button>
  <button onclick="runTest('message')">Send Test Message</button>

  <h2>Logs</h2>
  <button onclick="loadLogs('updates')">Load Updates</button>
  <button onclick="loadLogs('errors')">Load Errors</button>
  <button onclick="loadLogs('raw')">Load Raw Requests</button>
  <button class="danger" onclick="clearLogs()">Clear All Logs</button>
  <pre id="logs">Click a button above to load logs.</pre>

  <h2>Available Endpoints</h2>
  <pre>
GET  <span class="endpoint">/debug</span>                          This dashboard
GET  <span class="endpoint">/debug/api/ping</span>                  Liveness check
GET  <span class="endpoint">/debug/api/status</span>                Env introspection (masked secrets)
GET  <span class="endpoint">/debug/api/tests</span>                 List registered test endpoints
GET  <span class="endpoint">/debug/api/logs/updates</span>          Recent info events (30 max)
GET  <span class="endpoint">/debug/api/logs/errors</span>           Recent errors (30 max)
GET  <span class="endpoint">/debug/api/logs/raw</span>              Recent raw webhook requests (30 max)
POST <span class="endpoint">/debug/api/test/kv</span>               KV read/write round-trip
POST <span class="endpoint">/debug/api/test/message</span>          Send a test TG message
POST <span class="endpoint">/debug/api/test/cron</span>             Manually trigger cron queue
POST <span class="endpoint">/debug/api/test/:name</span>            Run a registered plugin test
POST <span class="endpoint">/debug/api/clear</span>                 Clear all debug logs
  </pre>

  <script>
    async function loadStatus() {
      try {
        const res = await fetch('/debug/api/status');
        const data = await res.json();
        const grid = document.getElementById('status');
        grid.innerHTML = '';
        const env = data.env || {};
        for (const [key, value] of Object.entries(env)) {
          const isBool = key.startsWith('has_');
          const badge = isBool
            ? (value ? '<span class="badge badge-ok">✓</span>' : '<span class="badge badge-error">✗</span>')
            : '';
          grid.innerHTML += \`
            <div class="card">
              <div class="card-label">\${key}</div>
              <div class="card-value">\${value} \${badge}</div>
            </div>
          \`;
        }
      } catch (e) {
        document.getElementById('status').innerHTML = '<div class="card"><div class="card-label">Error</div><div class="card-value">' + e.message + '</div></div>';
      }
    }

    async function runTest(name) {
      const logs = document.getElementById('logs');
      logs.textContent = 'Running ' + name + '...';
      try {
        let res;
        if (name === 'ping') {
          res = await fetch('/debug/api/ping');
        } else if (name === 'kv') {
          res = await fetch('/debug/api/test/kv', { method: 'POST' });
        } else if (name === 'cron') {
          res = await fetch('/debug/api/test/cron', { method: 'POST' });
        } else if (name === 'message') {
          res = await fetch('/debug/api/test/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
        }
        const data = await res.json();
        logs.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        logs.textContent = 'Error: ' + e.message;
      }
    }

    async function loadLogs(type) {
      const logs = document.getElementById('logs');
      logs.textContent = 'Loading ' + type + '...';
      try {
        const res = await fetch('/debug/api/logs/' + type);
        const data = await res.json();
        logs.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        logs.textContent = 'Error: ' + e.message;
      }
    }

    async function clearLogs() {
      if (!confirm('Clear all debug logs?')) return;
      await fetch('/debug/api/clear', { method: 'POST' });
      document.getElementById('logs').textContent = 'Logs cleared.';
      loadStatus();
    }

    loadStatus();
    setInterval(loadStatus, 30000);
  </script>
</body>
</html>`;
}
