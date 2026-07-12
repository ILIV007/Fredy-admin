# Fredy — Architecture Rules

> **Status:** Authoritative. Every Fredy module, file, and PR MUST comply with this document.
> **Relationship to AI Admin:** Fredy reuses ~40% of AI Admin's codebase and inherits its conventions. Where this document is silent, AI Admin's conventions apply. Where this document speaks, it overrides.
> **Audit reference:** See `fredy-prompt-0.5-engineering-report.md` for the full reverse-engineering audit that motivates many of these rules.

---

## 0. Why this file exists

AI Admin v0.6.1 is a working, production-hardened system, but its audit revealed five recurring problems that Fredy must not inherit:

1. **Dead code presented as live code.** The `ai/` knowledge base (24 files) is loaded but never sent to the AI. Maintainers waste time on it.
2. **Monolithic dispatchers.** `handleCallbackQuery` is a 265-line `if/else if` cascade. Every new screen edits the same function.
3. **Config and state are mixed in one KV blob.** Every stats flush rewrites the entire settings object — wasteful and racy.
4. **No plugin contracts.** Adding a new AI provider or content source requires editing core files.
5. **Plain JS with no schema validation.** Typos in setting keys silently create dead fields.

Every rule below exists to prevent one of these failures, to keep Cloudflare free-tier limits in view, or to keep the project extensible without rewrites.

---

## 1. Core Principles (priority order)

When two rules conflict, the earlier one wins.

1. **Correctness over cleverness.** A boring, readable solution beats a clever one.
2. **Maintainability over performance.** Performance is optimized only when measured.
3. **Extensibility over feature-richness.** A clean plugin contract beats a built-in feature.
4. **Cloudflare free-tier first.** Every design must work within Workers free limits (see §6).
5. **Type-safety over flexibility.** If TypeScript can catch it, it should.
6. **Config over code.** If a value might change, it lives in config, not in source.

---

## 2. Cloudflare First

Fredy runs on Cloudflare Workers. The runtime is **V8 isolates**, not Node.js.

**MUST:**
- Use only Web Platform APIs (`fetch`, `Request`, `Response`, `URL`, `crypto.subtle`, `TextEncoder`, `AbortController`, `setTimeout`, `setInterval`).
- Use `ctx.waitUntil()` for any work that should outlive the response. Telegram requires 200 within 60 s.
- Treat every isolate as ephemeral. Module-level state is a per-isolate cache, not a source of truth. KV is the source of truth.
- Declare all cron triggers in `wrangler.toml`. Free tier allows up to 5 cron triggers per Worker.
- Use KV for hot, small, frequently-read data. Use D1 only for relational/analytics data (see §7).

**MUST NOT:**
- Use Node-specific APIs (`fs`, `path`, `Buffer`, `process`, `node:crypto`).
- Use dynamic `import()` for code-splitting. Cloudflare's bundler handles it inconsistently. Use static imports. (Learned from AI Admin `ai.js` line 2649.)
- Read from the filesystem at runtime. Workers have no filesystem.
- Hold a DB connection across requests. Each handler opens, uses, closes.
- Block the event loop. All I/O must be `await`ed, never synchronous.

---

## 3. Layered Architecture

Fredy enforces a strict 4-layer architecture. **A layer may only call the layer directly below it.** No exceptions.

```
┌──────────────────────────────────────────────────────────┐
│ Layer 4: Entry Points                                    │
│   src/entry/webhook.ts, src/entry/cron.ts,               │
│   src/entry/debug.ts                                     │
│   Responsibility: parse the request, dispatch, return.   │
│   Forbidden: business logic, direct service calls.       │
├──────────────────────────────────────────────────────────┤
│ Layer 3: Orchestrators                                   │
│   src/orchestrators/pipeline.ts, scheduler.ts, admin.ts  │
│   Responsibility: compose services into workflows.       │
│   Forbidden: I/O primitives (fetch, KV.get, TG API).     │
├──────────────────────────────────────────────────────────┤
│ Layer 2: Services                                        │
│   src/services/*.ts                                      │
│   Responsibility: single-domain business logic.          │
│   Forbidden: knowing about other services directly.      │
│   Uses: primitives from Layer 1 via injected deps.       │
├──────────────────────────────────────────────────────────┤
│ Layer 1: Primitives                                      │
│   src/primitives/*.ts, src/types.ts, src/schemas.ts      │
│   Responsibility: pure functions, types, validators.     │
│   Forbidden: any I/O (no fetch, no KV, no fs).           │
└──────────────────────────────────────────────────────────┘
```

**Dependency rule:** dependencies flow **down only**. `webhook.ts` may import `pipeline.ts`; `pipeline.ts` may import `services/ai.ts`; `services/ai.ts` may import `primitives/strings.ts`. The reverse is forbidden. Circular imports at any layer are a bug.

**Cross-cutting concerns** (logging, error handling, config) live in `src/core/` and may be imported by any layer. They are not Layer 1 primitives because they may themselves use Layer 1.

---

## 4. Module System

### 4.1 File size limits

| Type | Soft limit | Hard limit |
|---|---|---|
| Entry point (Layer 4) | 100 lines | 200 lines |
| Orchestrator (Layer 3) | 250 lines | 400 lines |
| Service (Layer 2) | 200 lines | 300 lines |
| Primitive (Layer 1) | 150 lines | 250 lines |
| Single exported function | 50 lines | 80 lines (must have a comment explaining why) |

Files exceeding the hard limit MUST be split. The split axis is responsibility, not size — a 300-line file with one coherent responsibility is acceptable; a 200-line file with three responsibilities is not.

### 4.2 One responsibility per file

A file MUST export one of:
- A single class (the default export).
- A single interface and its factory function.
- A cohesive set of pure functions (Layer 1 only) that all operate on the same type.

A file MUST NOT export a grab-bag of unrelated helpers. If `utils.ts` exists, it is a folder, not a file — split by domain (`utils/strings.ts`, `utils/time.ts`, `utils/html.ts`).

### 4.3 No side effects on import

Importing a module MUST NOT execute I/O, mutate globals, or read config. Side effects happen inside functions, not at module top-level. The only exception is constant declarations (`export const FOO = "bar"`).

AI Admin violates this with module-level caches (`_cachedBotId`, `_statsCache`). Those caches are acceptable because they are lazy and per-isolate, but they must be wrapped in accessor functions, not exported directly.

---

## 5. Plugin Architecture

External services (content sources, AI providers, Telegram targets) are **plugins**. The core system never imports a specific plugin; plugins register themselves with a manager.

### 5.1 The dependency rule (inverted)

```
src/core/           ← defines interfaces (ContentSource, AIProvider, etc.)
src/plugins/        ← implements interfaces
src/orchestrators/  ← uses interfaces via managers
```

`orchestrators/pipeline.ts` calls `sourceManager.fetchForCategory(cat)`. It does NOT call `githubSource.fetch()`. Adding a new source means: (1) write `src/plugins/sources/hackernews.ts`, (2) register it in `src/container.ts`. Zero edits to orchestrators or services.

### 5.2 Plugin contract

Every plugin implements a known interface AND is registered in `container.ts`:

```ts
// src/plugins/sources/hackernews.ts
export class HackerNewsSource implements ContentSource {
  readonly name = "hackernews";
  readonly category: Category = "A";
  constructor(private deps: SourceDeps) {}
  async fetch(): Promise<SourceItem[]> { /* ... */ }
  async health(): Promise<HealthStatus> { /* ... */ }
}

// src/container.ts
sourceManager.register("hackernews", new HackerNewsSource(deps));
```

The constructor takes its dependencies (HTTP client, KV, config) — never reads them from a global. This makes the plugin testable in isolation.

### 5.3 What is a plugin vs. a service

| Concept | Type | Example |
|---|---|---|
| Content source | Plugin | GitHubSource, NewsSource, NasaSource, JokeSource |
| AI provider | Plugin | GeminiProvider, OpenRouterProvider |
| Storage backend | Service (not plugin) | KVStore — too entangled with runtime to swap |
| Telegram client | Service (not plugin) | One bot, one channel for now; multi-channel later |
| Soul loader | Service (not plugin) | One soul.md format |
| Formatter | Plugin | HtmlFormatter, PlainTextFormatter, SoulDrivenFormatter |
| Quality check | Plugin | LengthCheck, LanguageCheck, SpamCheck, DedupCheck |

If a future requirement asks "can we add X without touching core?", the answer should be yes if and only if X is a plugin contract.

---

## 6. SOLID — concrete application

### 6.1 Single Responsibility (SRP)

A class/function has one reason to change. Anti-example from AI Admin: `pipeline.js` exports `getBotId`, which is a Telegram concern. Fredy puts `getBotId` in `services/telegram.ts` and `pipeline.ts` calls it via the `TelegramService`.

### 6.2 Open/Closed (OCP)

Adding a feature = adding a file, not editing an existing one. The screen registry (§11) and command registry (§12) enforce this for the admin panel. The plugin manager (§5) enforces it for external services.

### 6.3 Liskov Substitution (LSP)

Any plugin implementation must be substitutable for any other. If `JokeSource.fetch()` returns `SourceItem[]` but `NasaSource.fetch()` returns `SourceItem & { imageUrl: string }`, the contract is broken. Either: (a) widen `SourceItem` to include optional `imageUrl`, or (b) introduce a `ImageSourceItem` sub-interface that consumers check for. Pick one and document it.

### 6.4 Interface Segregation (ISP)

No consumer should depend on methods it doesn't use. If `TelegramService` has both `sendMessage` and `setWebhook`, but the pipeline only uses `sendMessage`, the pipeline should depend on a `TelegramPublisher` interface with just `sendMessage` + `sendPhoto`. The full `TelegramService` is for the entry points.

### 6.5 Dependency Inversion (DIP)

High-level modules depend on interfaces, not concretions. `Pipeline` depends on `AIService` (interface), not `GeminiProvider` (class). The DI container (§13) wires concretions to interfaces at startup.

---

## 7. Storage

### 7.1 KV (primary store)

KV is the source of truth for: settings, state, content queue, scheduling slots, soul.md cache, source caches, debug logs, dedup hashes.

**KV write budget:** free tier = 1 000 writes/day. At 4 posts/day Fredy is fine, but the budget is shared with debug logging. Use the **batched-stats pattern** from AI Admin (`kv.js` lines 3635–3764): in-memory counter, flush every N increments or on `ctx.waitUntil`.

**Key namespacing** — all Fredy keys MUST start with `fredy:` and use a sub-namespace per concern:

| Prefix | Purpose | TTL |
|---|---|---|
| `fredy:settings:<adminId>` | Per-admin config blob (typed) | none |
| `fredy:state:<adminId>` | Per-admin runtime state (counters, last published, today's progress) | none |
| `fredy:global:config` | Channel-wide config (slots, quotas, default soul ref) | none |
| `fredy:queue:<category>` | Pending source items, JSON array, FIFO | items expire after 24 h |
| `fredy:sched:slots:<YYYY-MM-DD>` | Today's computed slot times | 48 h |
| `fredy:sched:sent:<YYYY-MM-DD>:<idx>` | Marker that slot N fired today | 48 h |
| `fredy:dedup:<hash>` | First-200-chars hash, for anti-repeat | 7 days |
| `fredy:source:<name>:cache` | Last fetched items from a source | per-source config (5–15 min) |
| `fredy:source:<name>:health` | Last fetch time, last error, rate-limit status | none |
| `fredy:soul` | Current soul.md content (overridable via admin panel) | none |
| `fredy:history:<YYYY-MM-DD>` | Daily published-posts summary | 90 days |
| `fredy:debug:updates` / `:errors` / `:raw` | Debug ring buffers (30 entries each) | none |
| `fredy:approve:<msgId>` | Pending approve-mode post data | 24 h |
| `fredy:convo:<adminId>` | Stateful conversation state (soul editor, manual post) | 30 min idle |

**Key format rule:** keys are lowercase, use `:` as separator, never contain spaces. Keys are documented in `src/core/storage/keys.ts` as a typed enum, not as string literals scattered across files.

### 7.2 D1 (analytics, optional)

D1 is **only** introduced when KV cannot answer a query. KV is fine for "what's the last published post"; it is wrong for "show me all Category A posts from last week where quality score was below 70".

D1 holds: `posts`, `source_fetches`, `ai_calls`, `admin_actions`. Every write to D1 is fire-and-forget via `ctx.waitUntil` — D1 must never block a publish.

D1 schema lives in `migrations/` as numbered SQL files. Never edit a migration; add a new one.

### 7.3 Secrets

Secrets are set via `wrangler secret put` and accessed via `env.BOT_TOKEN` etc. They MUST NOT:
- Appear in `wrangler.toml` `[vars]`.
- Be logged at any level (use `maskValue` from AI Admin `debug.js`).
- Be sent to AI prompts as user content.

Secrets Fredy uses: `BOT_TOKEN`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GITHUB_TOKEN` (optional), `NEWSAPI_KEY`, `NASA_API_KEY`, `WEBHOOK_SECRET`, `DEBUG_TOKEN`.

---

## 8. Configuration

### 8.1 Three tiers of configuration

| Tier | Where | Mutability | Example |
|---|---|---|---|
| Static | `wrangler.toml` `[vars]` | redeploy | `COMPATIBILITY_DATE`, KV binding IDs |
| Secrets | Cloudflare dashboard | `wrangler secret put` | `BOT_TOKEN` |
| Runtime | KV `fredy:settings:<id>` | admin panel, hot | `language`, `categories.A.quota`, `sources.github.enabled` |

Everything that an admin might reasonably change is Tier 3. Everything else is Tier 1 or 2.

### 8.2 Schema and validation

Settings are typed via a TypeScript interface AND validated at write time with zod. The schema lives in `src/core/schemas/settings.ts`. Every `updateConfig(patch)` runs through `validate(patch)`, which rejects unknown keys (preventing the AI Admin typo-silent-failure bug).

```ts
// shape — see FREDY_GUIDELINES.md for full content rules
interface FredySettings {
  schema_version: 1;
  language: "auto" | "en" | "fa";
  channel: string;
  footer: string;
  ai_provider: "gemini" | "openrouter" | "auto";
  scheduling: { enabled: boolean; slots: string[]; jitter_minutes: number; timezone: string };
  categories: Record<"A" | "B" | "C", { enabled: boolean; quota: number; weight: number }>;
  sources: Record<string, { enabled: boolean; interval_min: number }>;
  quality: { min_score: number; reject_duplicates: boolean; duplicate_ttl_hours: number };
  approve_mode: boolean;
  debug_mode: boolean;
}
```

### 8.3 Migration

Every settings blob carries `schema_version`. On read, if `schema_version < CURRENT`, run the migration chain `v0 → v1 → ... → vCURRENT`. Migrations live in `src/core/schemas/migrations.ts` and are pure functions. This prevents the AI Admin pattern where renamed fields orphan their old values.

### 8.4 Config vs. state (separation)

AI Admin mixes `stats` (state) into the settings blob. Fredy does not. **Config rarely changes; state changes often.** Splitting them avoids rewriting config on every stat bump and prevents races between concurrent settings edits and stat flushes.

- Config: `fredy:settings:<adminId>`
- State: `fredy:state:<adminId>` — counters, `last_published_at`, `last_source`, `last_category`, `today.{date, slots_fired, categories_published}`

### 8.5 No hardcoded values

Constants that could conceivably change belong in config. Constants that are mathematical truths (`MINUTES_PER_HOUR = 60`) or protocol identifiers (`TELEGRAM_API_BASE = "https://api.telegram.org"`) live in `src/core/constants.ts`. The test for "is this hardcoded value OK?" is: "if a user requested this be different, would I have to redeploy?"

---

## 9. Error Handling

### 9.1 Three-layer model

Fredy inherits AI Admin's three-layer error model:

1. **Entry point try/catch** — the webhook handler wraps everything in try/catch, logs to `logError`, returns 200 anyway. Telegram never sees a 500.
2. **Orchestrator try/catch** — `pipeline.ts` wraps the inner pipeline in `Promise.race` with a timeout. On timeout, edits the processing message to "Pipeline timed out" and exits gracefully.
3. **Per-operation try/catch** — every external call (Telegram, AI, KV, source fetch) is wrapped. Failure of one operation does not kill the orchestrator.

### 9.2 Never crash the Worker

No exception propagates to the runtime. Every `await` that can throw is wrapped, OR the function is documented to throw and the caller is documented to catch.

### 9.3 Typed errors

Errors carry context. Use a small `AppError` class:

```ts
class AppError extends Error {
  constructor(message: string, public context: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
  }
}
class SourceFetchError extends AppError {}
class AIProviderError extends AppError {}
class QualityRejectionError extends AppError { constructor(reason: string, public score: number) { super(reason); } }
```

`logError` serializes the `context` field, giving the debug dashboard structured data instead of stack traces alone.

### 9.4 Dead-letter queue

Items that fail N times (configurable, default 3) are moved to `fredy:dlq:<category>` instead of being retried forever. The debug dashboard surfaces them. (AI Admin lacks this — items can fail silently forever.)

---

## 10. Logging

### 10.1 Conditional KV logging (inherited from AI Admin)

Logs write to KV only when `env.DEBUG_MODE === "true"`. Otherwise they go to `console.log`/`console.error` only (visible in Cloudflare dashboard). This keeps the KV write budget untouched in production.

### 10.2 Log levels

| Level | When | Destination |
|---|---|---|
| `error` | Operation failed; user-visible impact | `console.error` always; KV if debug |
| `warn` | Operation recovered but suspicious | `console.warn`; KV if debug |
| `info` | Significant event (post published, slot fired) | `console.log`; KV if debug |
| `debug` | Verbose trace (per-stage timings, AI responses) | `console.log` only if debug |

### 10.3 What never gets logged

- `BOT_TOKEN`, API keys, `WEBHOOK_SECRET` — use `maskValue("BOT_TOKEN", env.BOT_TOKEN)` → `"BOT_TOKEN=***abc"`.
- Full Telegram update bodies — log only `updateType`, `fromId`, `chatId`, 80-char text preview (AI Admin pattern).
- Full AI prompts — log only the system prompt length and the user prompt length.
- User phone numbers, email addresses (Telegram doesn't send these, but if a source does, mask them).

### 10.4 Structured log entries

Every log entry is a JSON object with `time`, `level`, `event`, `context`. The `event` is a stable string (`"pipeline.start"`, `"ai.success"`, `"source.fetch_failed"`) so the dashboard can filter on it. Free-text log messages are forbidden at the KV level — they're fine for `console.log` only.

---

## 11. Debug

### 11.1 Debug mode is config-driven

`debug_mode: boolean` lives in settings. When off, KV debug writes are skipped entirely. When on, ring buffers (30 entries each) are maintained for updates, errors, raw webhook requests.

### 11.2 Debug dashboard endpoints

The `/debug` HTML page and `/debug/api/*` endpoints are inherited from AI Admin and extended. Each plugin registers its own test endpoint via `debugService.registerTest(name, handler)`. The dashboard auto-discovers registered tests.

Standard endpoints (always present):
- `GET /debug` — HTML dashboard
- `GET /debug/api/ping` — liveness
- `GET /debug/api/status` — env introspection (masked secrets)
- `POST /debug/api/test/message` — send a test Telegram message
- `POST /debug/api/test/kv` — KV round-trip
- `POST /debug/api/test/ai` — AI rewrite with hardcoded text
- `POST /debug/api/simulate/post?category=A&source=github` — full pipeline without publishing
- `POST /debug/api/simulate/slot` — what would the next slot publish?
- `POST /debug/api/clear` — clear debug logs

Per-plugin endpoints (registered):
- `POST /debug/api/test/source/<name>` — fetch one item from a source, return raw + processed
- `POST /debug/api/test/provider/<name>` — call one AI provider with a fixed prompt

### 11.3 Debug must never expose secrets

`getStatus` uses `maskValue` to show `has_bot_token: true` instead of the token. Every new debug endpoint that echoes env must use the same masking.

---

## 12. Admin Panel (registry-based)

### 12.1 Screen registry (replaces AI Admin's if/else cascade)

AI Admin's `handleCallbackQuery` is 265 lines of `if (data === "...")` branches. Fredy replaces it with a `ScreenRegistry`:

```ts
interface Screen {
  readonly id: string;                       // "main", "schedule", "soul"
  text(settings: FredySettings, env?: Env): Promise<string> | string;
  keyboard(settings: FredySettings): InlineKeyboard;
  onCallback?(data: string, ctx: CallbackContext): Promise<ScreenAction>;
}
```

`handleCallbackQuery` becomes ~20 lines: parse `data` → look up screen → call `onCallback` → render result. Adding a screen = one file + one registration line.

### 12.2 Command registry

Same pattern for commands:

```ts
interface Command {
  readonly name: string;                     // "/start", "/soul"
  readonly description: string;
  handle(ctx: CommandContext): Promise<void>;
}
```

### 12.3 Stateful conversations

Some flows (soul editor, manual post composer) need multi-message input. State lives at `fredy:convo:<adminId>` with a 30-min idle TTL:

```ts
type ConvoState =
  | { type: "idle" }
  | { type: "soul_edit"; step: "awaiting_text"; draft: string }
  | { type: "manual_post"; step: "awaiting_text" | "awaiting_category"; draft: string };
```

The webhook handler checks for an active conversation BEFORE routing to commands. If a conversation is active, the message goes to its handler instead.

---

## 13. Dependency Injection

### 13.1 Hand-rolled container

Fredy does not use a DI library. A single `buildContainer(env)` function in `src/container.ts` constructs all services in dependency order:

```ts
interface Container {
  tg: TelegramService;
  kv: KVStore;
  ai: AIService;
  soul: SoulLoader;
  sources: SourceManager;
  categories: CategoryManager;
  scheduler: SchedulerService;
  quality: QualityFilter;
  formatter: FormatterService;
  lang: LanguageManager;
  debug: DebugService;
  config: ConfigService;
}

function buildContainer(env: Env): Container { /* ... */ }
```

Every entry point receives the container, not `env` directly. Services receive their dependencies via constructor, never via global lookup.

### 13.2 Why not classes-with-static-methods

Static methods are global state. They cannot be mocked. They cannot be swapped. Fredy uses instance methods exclusively.

### 13.3 Why not a DI library

A library adds bundle size and abstraction. Fredy has ~12 services — manual wiring is 30 lines. The cost of a library is not justified.

---

## 14. TypeScript Standards

### 14.1 Strict mode

`tsconfig.json` enables `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`.

### 14.2 No `any`

`any` is forbidden. Use `unknown` and narrow with type guards. The only exception is third-party API responses that genuinely have no schema — and even then, immediately parse them through a zod schema and treat the result as typed.

### 14.3 Prefer interfaces over types

Use `interface` for object shapes (extensible, error messages are clearer). Use `type` for unions, intersections, and utility types.

### 14.4 Readonly everywhere

Fields that don't change after construction are `readonly`. Function parameters that aren't mutated are `readonly`. Arrays that aren't modified are `readonly T[]`. This catches accidental mutations at compile time.

### 14.5 Explicit return types

Every exported function has an explicit return type. Inferred return types are acceptable for private helpers.

### 14.6 Enums vs. union types

Prefer string union types (`type Category = "A" | "B" | "C"`) over `enum`. Unions are lighter, tree-shakeable, and don't generate runtime code. Use `enum` only when the values must be iterated (`Object.values(MyEnum)`), which is rare.

---

## 15. Naming Conventions

| Element | Convention | Example |
|---|---|---|
| File | `kebab-case.ts` or single word | `kv-store.ts`, `telegram.ts` |
| Folder | `kebab-case` | `content-engine/` |
| Class | `PascalCase` | `GeminiProvider` |
| Interface | `PascalCase`, no `I` prefix | `ContentSource` (not `IContentSource`) |
| Function | `camelCase` | `fetchForCategory` |
| Constant | `UPPER_SNAKE_CASE` | `MAX_POSTS_PER_DAY` |
| Type alias | `PascalCase` | `Category`, `SlotTime` |
| KV key | `lowercase:with:colons` | `fredy:settings:123` |
| Callback data | `namespace:action[:args]` | `set:sched:delay:inc` |
| Env var | `UPPER_SNAKE_CASE` | `OPENROUTER_API_KEY` |

### 15.1 No abbreviations

`btn`, `cfg`, `msg`, `usr` are forbidden. Use `button`, `config`, `message`, `user`. The only allowed abbreviation is `tg` for Telegram (because `telegram` is long and the prefix appears in many file names).

### 15.2 Boolean names start with `is`/`has`/`should`/`can`

`enabled`, `ok`, `done` are forbidden as booleans. Use `isEnabled`, `isOk`, `isDone`, `hasFailed`, `shouldRetry`, `canPublish`.

---

## 16. Code Style

### 16.1 No deep nesting

Maximum nesting depth is 3. Deeper than that, extract a helper function. Use early returns (guard clauses) instead of wrapping logic in `if`.

### 16.2 No magic numbers

Numbers that aren't obviously meaningful get a named constant. `30` in `Math.min(30, x)` is unclear; `MAX_SCHEDULE_JITTER_MINUTES` is clear. The exception is `0`, `1`, `-1` in obvious arithmetic.

### 16.3 Comments explain why, not what

```ts
// Bad: increment counter
counter++;

// Good: KV write budget is 1000/day, so we batch in memory and flush every 10
if (++counter >= BATCH_FLUSH_THRESHOLD) await flush();
```

The "what" is the code's job. The "why" is the comment's job.

### 16.4 No commented-out code

Dead code in comments rots. Use git history. If you must keep a snippet for reference, put it in a `// TODO: ...` block with a ticket link.

---

## 17. Documentation

### 17.1 Public modules

Every exported class, interface, and function has a TSDoc comment explaining:
- What it does (one line).
- Why it exists (if non-obvious).
- Parameters and return value (if not obvious from types).
- An example, if the API is non-trivial.

### 17.2 File-level header

Every file starts with a 3–10 line comment block:

```ts
/**
 * src/services/ai-service.ts
 * Multi-provider AI race with cancellation. The first provider to succeed
 * wins; all others are aborted via AbortController to save tokens.
 * Reused from AI Admin v0.6.1 ai.js, refactored to AIProvider interface.
 */
```

### 17.3 Decision records

Non-obvious architectural choices are documented in `docs/decisions/<topic>.md` (e.g., `why-no-d1-for-queue.md`, `why-screen-registry-over-router.md`). When a maintainer asks "why is X like this?", the answer should be one click away.

---

## 18. Performance

### 18.1 Cache aggressively, invalidate explicitly

Source fetches are cached in KV for 5–15 min (per-source config). AI responses are NOT cached (they include soul.md which can change). Settings are cached in-memory per isolate (acceptable staleness: 1 request).

### 18.2 Parallelize independent I/O

The AI race pattern (Promise.any with cancellation) is the canonical example. Source health checks can run in parallel. Settings + state reads at the start of a pipeline run can be `Promise.all`'d.

### 18.3 AbortController on every external call

Every `fetch` (AI, source, Telegram) accepts an AbortSignal. Timeouts are enforced via `setTimeout(() => controller.abort(), ms)`. This prevents a single slow provider from blocking the pipeline.

### 18.4 KV read batching

If a handler needs 3 KV keys, use `Promise.all` rather than 3 sequential `await`s. KV latency is ~10–50 ms per read; sequential reads add up.

### 18.5 Avoid `JSON.parse` on hot paths

If a JSON blob is read on every request, parse it once per isolate and cache the parsed object. AI Admin does this implicitly via the `_statsCache` pattern; Fredy does it explicitly via `cachedGet<T>(key, parser)`.

---

## 19. Testing

### 19.1 What to test

- All `src/primitives/` — pure functions, 100% coverage is achievable and expected.
- All `src/services/` — tested via mock dependencies, ≥80% coverage.
- All `src/orchestrators/` — tested via mock services, ≥70% coverage (the integration glue is hard to test fully).
- All `src/plugins/` — each plugin has at least one happy-path and one failure-path test.

### 19.2 What not to test

- `src/entry/` — too thin to be worth unit-testing; covered by integration tests.
- Third-party APIs — mock them.

### 19.3 Framework

Use `node:test` (built-in, no dependency) for unit tests. Use `wrangler dev` + a real Telegram test bot for end-to-end tests of the webhook flow, gated behind an env flag (`RUN_E2E=true`).

---

## 20. Future-Readiness

Fredy is designed to grow without rewrites. The expected future axes:

| Future requirement | How it's supported |
|---|---|
| More content sources | `ContentSource` plugin interface; register in container |
| More AI providers | `AIProvider` plugin interface; register in container |
| More languages | `LanguageManager` config + per-language rules in soul.md |
| Multiple Telegram channels | `fredy:settings:<adminId>` already supports per-admin; add `channels` registry later |
| More content categories | `categories: Record<string, ...>` in settings; category manager iterates keys |
| Web UI (non-Telegram admin) | Orchestrators are TG-agnostic; a new `entry/web.ts` can render the same screens as HTML |
| Schedule changes | Slot times are config; cron triggers are independent |
| Soul.md variations per category | SoulLoader can return category-specific sections |

The test of future-readiness: "if requirement X arrives, how many core files change?" The answer should be ≤2 (usually just `container.ts` and the new file itself).

---

## 21. Audit-Derived Rules (explicit lessons)

These rules exist because AI Admin violated them. They are listed here so future maintainers understand the cost of removing them.

| # | Rule | Origin in AI Admin |
|---|---|---|
| 21.1 | No `ai/` knowledge base that isn't sent to the AI. If rules are valuable, they go in soul.md. | `ai/*.js` (24 files, dead code) |
| 21.2 | Admin callback dispatchers MUST be a registry, not an if/else cascade. | `admin.js` `handleCallbackQuery` (265 lines) |
| 21.3 | Settings and state MUST be in separate KV keys. | `kv.js` mixes `stats` into `settings` blob |
| 21.4 | Setting keys MUST be schema-validated on write. | `updateSetting` accepts any string key |
| 21.5 | Scheduling MUST be slot-based, time-driven, with jitter — not delay-from-now. | `schedule_delay_hours` is delay-from-now |
| 21.6 | Multi-model AI race MUST cancel losers via shared AbortController. | `ai.js` does this — keep it |
| 21.7 | Conditional debug logging MUST skip KV writes when debug_mode is off. | `debug.js` does this — keep it |
| 21.8 | Cron fallback for Telegram scheduling MUST be silent and queue-based. | `processScheduledQueue` — keep it |
| 21.9 | Prompt protection (placeholders for sensitive blocks) is N/A for Fredy (no user prompts). | Drop it. |
| 21.10 | `getBotId` belongs in `telegram.ts`, not `pipeline.ts`. | SRP violation |
| 21.11 | Static imports only — dynamic `import()` is unreliable on Cloudflare. | `ai.js` line 2649 comment |
| 21.12 | Never mix `stats` (state) into the settings blob. | Reread 21.3 if unclear |
| 21.13 | Every external fetch MUST have an AbortController-based timeout. | `fetchWithTimeout` — keep it |
| 21.14 | Stats MUST be batched in-memory and flushed on `ctx.waitUntil`. | `bumpStats` pattern — keep it |
| 21.15 | Secrets MUST be masked in debug output. | `maskValue` — keep it |

---

## 22. Compliance Checklist (for PRs)

Before merging any PR, confirm:

- [ ] No `any` types added.
- [ ] No new hardcoded values that should be config.
- [ ] No new secrets in `wrangler.toml` `[vars]`.
- [ ] No file exceeds its hard size limit (§4.1).
- [ ] No new code in `src/entry/` that does business logic.
- [ ] No new direct call from an orchestrator to a concrete plugin (must go through a manager).
- [ ] No new `if (data === "...")` branch in a callback dispatcher — use the screen registry.
- [ ] No new console.log of secrets or full request bodies.
- [ ] No new feature without a corresponding config field (if the user might want to toggle it).
- [ ] No new KV key outside the `fredy:` namespace.
- [ ] All new external `fetch` calls have AbortController timeouts.
- [ ] All new errors use `AppError` subclasses with context.
- [ ] Public functions have TSDoc.
- [ ] Tests added for new primitives and services.

---

**End of `ARCHITECTURE_RULES.md`.**
