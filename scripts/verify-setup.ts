/**
 * scripts/verify-setup.ts
 * Post-deploy verification script.
 *
 * Usage:
 *   npx tsx scripts/verify-setup.ts <WORKER_URL> [DEBUG_TOKEN]
 *
 * Example:
 *   npx tsx scripts/verify-setup.ts https://fredy.xxx.workers.dev my-debug-token
 *
 * This script checks:
 *   1. Health endpoint (/)
 *   2. Version endpoint (/version)
 *   3. Detailed health (/health)
 *   4. Debug ping (/debug/api/ping) — requires DEBUG_TOKEN
 *   5. Debug status (/debug/api/status) — requires DEBUG_TOKEN
 *   6. Plugin registration (/debug/api/tests)
 *   7. Telegram webhook info (/webhook/info)
 */

const WORKER_URL = process.argv[2];
const DEBUG_TOKEN = process.argv[3];

if (!WORKER_URL) {
  console.error("Usage: npx tsx scripts/verify-setup.ts <WORKER_URL> [DEBUG_TOKEN]");
  process.exit(1);
}

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

async function check(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  try {
    const detail = await fn();
    return { name, ok: true, detail };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  console.log(`\n🔍 Fredy Deployment Verification\n`);
  console.log(`Worker URL: ${WORKER_URL}\n`);

  const results: CheckResult[] = [];

  // 1. Health check
  results.push(await check("Health (/)", async () => {
    const data = await fetchJson(`${WORKER_URL}/`) as { ok: boolean; version: string };
    return `ok=${data.ok}, version=${data.version}`;
  }));

  // 2. Version
  results.push(await check("Version (/version)", async () => {
    const data = await fetchJson(`${WORKER_URL}/version`) as { name: string; version: string; phase: string };
    return `${data.name} v${data.version} (${data.phase})`;
  }));

  // 3. Detailed health
  results.push(await check("Detailed Health (/health)", async () => {
    const data = await fetchJson(`${WORKER_URL}/health`) as {
      status: string;
      missingRequired: string[];
      missingRecommended: string[];
    };
    let detail = `status=${data.status}`;
    if (data.missingRequired.length > 0) {
      detail += `, missing required: ${data.missingRequired.join(", ")}`;
    }
    if (data.missingRecommended.length > 0) {
      detail += `, missing recommended: ${data.missingRecommended.length}`;
    }
    return detail;
  }));

  // 4. Debug ping (requires DEBUG_TOKEN)
  if (DEBUG_TOKEN) {
    results.push(await check("Debug Ping (/debug/api/ping)", async () => {
      const data = await fetchJson(`${WORKER_URL}/debug/api/ping`, {
        Authorization: `Bearer ${DEBUG_TOKEN}`,
      }) as { ok: boolean; has_bot_token: boolean; has_kv: boolean };
      return `ok=${data.ok}, hasBotToken=${data.has_bot_token}, hasKV=${data.has_kv}`;
    }));

    // 5. Debug status
    results.push(await check("Debug Status (/debug/api/status)", async () => {
      const data = await fetchJson(`${WORKER_URL}/debug/api/status`, {
        Authorization: `Bearer ${DEBUG_TOKEN}`,
      }) as {
        enabled: boolean;
        env: Record<string, unknown>;
      };
      const env = data.env as Record<string, unknown>;
      const checks = [
        `hasBotToken=${env.has_bot_token}`,
        `hasKV=${env.has_kv}`,
        `hasGemini=${env.has_gemini}`,
        `hasOpenRouter=${env.has_openrouter}`,
      ];
      return checks.join(", ");
    }));

    // 6. Registered tests
    results.push(await check("Plugin Tests (/debug/api/tests)", async () => {
      const data = await fetchJson(`${WORKER_URL}/debug/api/tests`, {
        Authorization: `Bearer ${DEBUG_TOKEN}`,
      }) as { count: number; tests: Array<{ name: string }> };
      return `${data.count} tests registered: ${data.tests.map((t) => t.name).join(", ")}`;
    }));
  } else {
    results.push({ name: "Debug Ping (skipped — no DEBUG_TOKEN)", ok: true, detail: "Pass DEBUG_TOKEN as 2nd arg to verify" });
  }

  // 7. Telegram webhook info
  results.push(await check("Telegram Bot Info (/webhook/info)", async () => {
    const data = await fetchJson(`${WORKER_URL}/webhook/info`) as {
      ok: boolean;
      result?: { username: string; first_name: string };
    };
    if (data.ok && data.result) {
      return `@${data.result.username} (${data.result.first_name})`;
    }
    return `ok=${data.ok}`;
  }));

  // Print results
  console.log("─".repeat(60));
  let allOk = true;
  for (const result of results) {
    const icon = result.ok ? "✅" : "❌";
    console.log(`${icon} ${result.name}`);
    console.log(`   ${result.detail}`);
    if (!result.ok) allOk = false;
  }
  console.log("─".repeat(60));

  if (allOk) {
    console.log("\n✅ All checks passed! Fredy is ready for production.\n");
    process.exit(0);
  } else {
    console.log("\n❌ Some checks failed. Review the output above.\n");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
