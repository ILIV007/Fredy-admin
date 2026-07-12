# Fredy — Configuration Guide

> **Status:** Authoritative reference for all config sections.
> **Consumers:** `ConfigService`, admin panel, debug dashboard, all services that read config.
> **Relationship to ARCHITECTURE_RULES.md:** ARCHITECTURE_RULES §8 defines the rules; this file documents the sections.

---

## Architecture

Fredy uses a **pluggable section-based configuration system**. Each config section is a self-contained module with:

- A unique key (e.g., `"general"`, `"scheduler"`, `"ai"`)
- A Zod schema for validation
- Default values
- A schema version (for migrations)
- An optional `migrate()` function
- A human-readable description

The `ConfigSectionRegistry` composes all sections into the full `FredySettings` blob. Adding a new section requires:

1. Write `src/core/config/sections/my-section.ts`
2. Register it in `src/core/config/sections/index.ts`
3. Add the type to `src/types/config.ts`

**No existing code changes.** This satisfies ARCHITECTURE_RULES §5 (Plugin First) for configuration.

---

## Services

| Service | File | Responsibility |
|---|---|---|
| `ConfigSectionRegistry` | `src/core/config/section-registry.ts` | Register sections, build defaults, validate, migrate |
| `ConfigRepository` | `src/services/config-repository.ts` | KV I/O (load, save, delete, export, import) |
| `ConfigCache` | `src/services/config-cache.ts` | In-memory cache (30s TTL, per-isolate) |
| `ConfigService` | `src/services/config-service.ts` | Public API (get/set/reset/validate/export/import) |

### Public API

```typescript
// Read
const settings = await container.config.getSettings(adminId);
const state = await container.config.getState(adminId);
const aiConfig = await container.config.getSection<AIConfig>(adminId, "ai");

// Write
await container.config.updateSettings(adminId, { ai: { temperature: 0.5 } });
await container.config.updateSection(adminId, "ai", newAiConfig);
await container.config.resetSettings(adminId);
await container.config.resetSection(adminId, "ai");

// Validate
const result = await container.config.validateSettings(inputBlob);

// Export / Import
const exportResult = await container.config.exportSettings(adminId);
const importResult = await container.config.importSettings(adminId, jsonString);

// State (separate from settings)
await container.config.updateState(adminId, (state) => ({ ...state, lastPublishedAt: Date.now() }));
await container.config.resetState(adminId);

// Introspection
const sections = container.config.listSections(); // [{ key, description, version }, ...]
const cacheStats = container.config.cacheStats(); // { size, ttlMs }
```

---

## Sections

### 1. `general`

Bot-wide toggles and environment.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `botEnabled` | `boolean` | `true` | Master switch — when false, Fredy stops publishing |
| `maintenanceMode` | `boolean` | `false` | When true, Fredy only accepts admin commands, no auto-publishing |
| `environment` | `"development" \| "staging" \| "production"` | `"production"` | Deployment environment |
| `timezone` | `string` | `"Asia/Tehran"` | IANA timezone for all date/time operations |
| `channelName` | `string` | `"ILIVIR3"` | Display name for the channel |

### 2. `telegram`

Telegram channel and admin configuration.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `targetChannel` | `string` | `"@ILIVIR3"` | Channel to publish to |
| `adminId` | `string` | `""` | Admin's Telegram user ID (set from env on first run) |
| `footer` | `string` | `"🌀 @ILIVIR3"` | Footer appended to non-NASA posts |
| `parseMode` | `"HTML" \| "MarkdownV2"` | `"HTML"` | Telegram parse mode |
| `disableWebPagePreview` | `boolean` | `true` | Whether to disable link previews |

### 3. `language`

Language configuration. Supports future language expansion.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `default` | `"auto" \| "en" \| "fa"` | `"auto"` | Default language; `auto` = detect from source |
| `supported` | `("en" \| "fa")[]` | `["en", "fa"]` | Languages Fredy can generate in |
| `autoDetect` | `boolean` | `true` | Whether to auto-detect language from source content |

**Adding a language:** extend the `supported` enum in `language.ts` and add per-language rules in `soul.md`. No code changes needed.

### 4. `scheduler`

Slot-based scheduler configuration.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `enabled` | `boolean` | `false` | Master switch for auto-scheduling |
| `slots` | `string[]` (HH:MM) | `["09:00", "13:00", "18:00", "22:00"]` | Daily posting slots |
| `jitterMinutes` | `number` | `30` | Random offset (±minutes) applied to each slot |
| `timezone` | `string` | `"Asia/Tehran"` | Timezone for slot computation |
| `postingWindows` | `{start, end}[]` | `[]` | Allowed posting windows (empty = any time) |
| `burstPosting` | `boolean` | `false` | Allow multiple posts in one slot |
| `skipIfLowQuality` | `boolean` | `true` | Skip slot if no quality content available |

### 5. `categories`

Per-category configuration.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `A` | `CategoryItem` | `{enabled:true, dailyLimit:2, ...}` | Category A (dev content) |
| `B` | `CategoryItem` | `{enabled:true, dailyLimit:1, ...}` | Category B (tech news) |
| `C` | `CategoryItem` | `{enabled:true, dailyLimit:1, ...}` | Category C (NASA/joke/quote/fact) |
| `rotationOrder` | `("A"\|"B"\|"C")[]` | `["A","B","A","C"]` | Preferred rotation across 4 slots |
| `allowSameCategoryTwice` | `boolean` | `false` | Allow same category on consecutive slots |

**CategoryItem shape:**
| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Whether this category is active |
| `dailyLimit` | `number` | Max posts per day |
| `priority` | `number` | 1=highest (used when multiple categories have quota) |
| `weight` | `number` | Relative probability when priorities are equal |
| `fallback` | `"skip" \| "next" \| "retry"` | What to do when no content available |

### 6. `ai`

AI generation configuration.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `primaryProvider` | `"gemini" \| "openrouter"` | `"openrouter"` | Primary AI provider |
| `fallbackProvider` | `"gemini" \| "openrouter" \| "none"` | `"gemini"` | Fallback if primary fails |
| `temperature` | `number` (0–2) | `0.7` | AI temperature |
| `maxTokens` | `number` | `3096` | Max output tokens |
| `retryCount` | `number` | `2` | Retries before giving up |
| `promptProfile` | `"default" \| "concise" \| "detailed"` | `"default"` | Prompt style |
| `qualityThreshold` | `number` (0–100) | `60` | Minimum quality score to publish |
| `timeoutMs` | `number` | `15000` | Per-call timeout |

### 7. `providers`

Per-provider configuration (model lists, limits).

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `gemini` | `ProviderConfig` | `{enabled, models:[...], ...}` | Gemini provider config |
| `openrouter` | `ProviderConfig` | `{enabled, models:[...], ...}` | OpenRouter provider config |

**ProviderConfig shape:**
| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Whether this provider is active |
| `models` | `string[]` | Model IDs in priority order |
| `timeoutMs` | `number` | Per-call timeout |
| `retryCount` | `number` | Retries per model |
| `dailyLimit` | `number` | Max API calls per day |
| `priority` | `number` | 1=highest (used in fallback chain) |

### 8. `content`

Content publishing rules.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `postsPerDay` | `number` | `4` | Total posts per day |
| `categoryDistribution` | `{A,B,C}` | `{50,25,25}` | Percentage per category (must sum to 100) |
| `randomOffsetMinutes` | `number` | `30` | Random offset for posting time |
| `burstPosting` | `boolean` | `false` | Allow multiple posts in burst |
| `duplicatePrevention` | `boolean` | `true` | Whether to prevent duplicates |
| `duplicateTtlHours` | `number` | `168` (7 days) | How long to remember dedup hashes |
| `sourceFooterFormat` | `string` | `"{emoji}Source"` | Format for the source footer line |
| `sourceEmojiPool` | `string[]` | `[20 emojis]` | Emoji rotation pool |
| `emojiHistorySize` | `number` | `10` | How many recent emojis to track |

### 9. `quality`

Quality filter thresholds.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `minScore` | `number` (0–100) | `60` | Minimum quality score to publish |
| `duplicateDetection` | `boolean` | `true` | Whether to check dedup hashes |
| `duplicateTtlHours` | `number` | `168` | Dedup hash TTL |
| `spamProtection` | `boolean` | `true` | Whether to check spam patterns |
| `spamPatterns` | `string[]` | `[5 regexes]` | Regex patterns to reject |
| `minLength` | `number` | `80` | Minimum post length |
| `maxLength` | `number` | `4096` | Maximum post length |
| `rejectEmptyOutput` | `boolean` | `true` | Hard reject empty AI output |
| `rejectWrongLanguage` | `boolean` | `true` | Hard reject wrong language |
| `rejectBrokenHtml` | `boolean` | `true` | Hard reject unbalanced HTML |

### 10. `debug`

Debug system configuration.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `enabled` | `boolean` | `false` | Master switch for debug mode |
| `logLevel` | `"error" \| "warn" \| "info" \| "debug"` | `"info"` | Minimum level to log |
| `simulationMode` | `boolean` | `false` | Run pipeline without publishing |
| `verboseOutput` | `boolean` | `false` | Verbose console output |
| `ringBufferCapacity` | `number` | `30` | Max entries per ring buffer |

### 11. `logging`

Logging configuration (where logs go, separate from what's captured).

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `kvWrites` | `boolean` | `true` | Whether to write logs to KV |
| `consoleLevel` | `"error" \| "warn" \| "info" \| "debug"` | `"info"` | Console log level |
| `kvLevel` | `"error" \| "warn" \| "info" \| "debug"` | `"info"` | KV log level |
| `includeStackTrace` | `boolean` | `true` | Include stack traces in error logs |
| `maxContextLength` | `number` | `2000` | Max JSON context length per log entry |

### 12. `nasa`

NASA APOD-specific configuration.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `dailyPost` | `boolean` | `true` | Whether to include NASA in Category C rotation |
| `captionLength` | `number` | `400` | Max caption length for NASA posts |
| `imagePreference` | `"hd" \| "standard"` | `"hd"` | HD vs standard image URL |
| `skipConsecutiveDays` | `boolean` | `true` | Don't post NASA two days in a row |
| `includeVideoAsLink` | `boolean` | `true` | For video APODs, send URL as link |

### 13. `plugins`

Plugin manager configuration.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `defaultTimeoutMs` | `number` | `15000` | Default timeout for all plugins |
| `defaultRetryCount` | `number` | `1` | Default retry count |
| `defaultDailyLimit` | `number` | `100` | Default daily API call limit |
| `perPlugin` | `Record<string, PluginOverride>` | `{github, news, nasa, joke}` | Per-plugin overrides |

**PluginOverride shape:** all fields optional, override the defaults:
| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean?` | Enable/disable this plugin |
| `priority` | `number?` | Plugin priority (1=highest) |
| `timeoutMs` | `number?` | Per-call timeout |
| `retryCount` | `number?` | Retries |
| `dailyLimit` | `number?` | Daily API call limit |
| `metadata` | `Record<string, unknown>?` | Free-form plugin metadata |

### 14. `future`

Future extensions placeholder.

| Field | Type | Default | Description |
|---|---|---|---|
| `_version` | `1` | `1` | Schema version |
| `extensions` | `Record<string, unknown>` | `{}` | Free-form key-value map for experimental config |

---

## How to Add a New Section

1. **Create the section file:** `src/core/config/sections/my-section.ts`

```typescript
import { z } from "zod";

export const mySectionSchema = z.object({
  _version: z.literal(1),
  enabled: z.boolean(),
  label: z.string(),
});

export type MySectionConfig = z.infer<typeof mySectionSchema>;

export const mySectionDefaults: MySectionConfig = {
  _version: 1,
  enabled: false,
  label: "My Section",
};

export const mySection = {
  key: "mySection",
  version: 1,
  schema: mySectionSchema,
  defaults: mySectionDefaults,
  description: "Description shown in the config guide and admin panel.",
};
```

2. **Register it:** edit `src/core/config/sections/index.ts`

```typescript
import { mySection } from "./my-section";
export * from "./my-section";

export function registerAllSections(registry: ConfigSectionRegistry): void {
  // ... existing registrations ...
  registry.register(mySection);
}
```

3. **Add the type:** edit `src/types/config.ts`

```typescript
import type { MySectionConfig } from "../core/config/sections/my-section";

export interface FredySettings {
  // ... existing sections ...
  readonly mySection: MySectionConfig;
}
```

4. **Done.** The new section is now:
   - Loaded from KV with migration
   - Validated on write
   - Available via `container.config.getSection<MySectionConfig>(adminId, "mySection")`
   - Editable via `container.config.updateSettings(adminId, { mySection: { enabled: true } })`
   - Exportable/importable via the export/import API
   - Visible in `container.config.listSections()`

**No other files need to change.**

---

## How to Migrate a Section

When a section's schema changes, bump its version and add a `migrate` function:

```typescript
export const mySection = {
  key: "mySection",
  version: 2,  // was 1, now 2
  schema: mySectionV2Schema,
  defaults: mySectionV2Defaults,
  description: "...",

  migrate(from: number, input: unknown): unknown {
    if (from === 1) {
      // Migrate v1 → v2: add the new `priority` field with a default.
      const old = input as Partial<MySectionV1Config>;
      return {
        _version: 2,
        enabled: old.enabled ?? false,
        label: old.label ?? "Default",
        priority: 5,  // new field
      };
    }
    return input;
  },
};
```

The registry's `migrateAll` function calls `migrate(1, input)` then `migrate(2, input)` etc. until the data reaches the current version.

---

## Config vs State

Fredy separates **config** (rarely changes) from **state** (changes often):

| | Config | State |
|---|---|---|
| KV key | `fredy:settings:<adminId>` | `fredy:state:<adminId>` |
| Changes | Admin panel, import/export | Every publish, every stat bump |
| Validated | Yes (Zod schema) | No (runtime data) |
| Cached | Yes (30s TTL) | No (read fresh each time) |
| Example | `ai.temperature` | `stats.published` |

This separation prevents the AI Admin bug where every stat flush rewrites the entire settings blob (§21.3).

---

## Examples

### Reading a config value

```typescript
// In any service that has access to `container`:
const settings = await container.config.getSettings(adminId);
const temperature = settings.ai.temperature;
const maxPosts = settings.content.postsPerDay;
const enabledSources = Object.entries(settings.plugins.perPlugin)
  .filter(([, p]) => p.enabled)
  .map(([name]) => name);
```

### Updating a config value

```typescript
// Update a single field:
await container.config.updateSettings(adminId, {
  ai: { temperature: 0.5 },
});

// Update an entire section:
await container.config.updateSection(adminId, "scheduler", {
  _version: 1,
  enabled: true,
  slots: ["10:00", "14:00", "18:00", "22:00"],
  jitterMinutes: 20,
  timezone: "Asia/Tehran",
  postingWindows: [],
  burstPosting: false,
  skipIfLowQuality: true,
});
```

### Resetting config

```typescript
// Reset everything:
await container.config.resetSettings(adminId);

// Reset one section:
await container.config.resetSection(adminId, "ai");
```

### Export/Import (backup/restore)

```typescript
// Export:
const result = await container.config.exportSettings(adminId);
// result.json is a JSON string — save to a file or share.

// Import:
const result = await container.config.importSettings(adminId, jsonString);
if (!result.ok) {
  console.error("Import failed:", result.error);
}
```

### Validating without saving

```typescript
const result = await container.config.validateSettings(inputBlob);
if (!result.ok) {
  console.error("Validation errors:", result.errors);
  // errors is { "ai": "invalid_type...", "scheduler": "..." }
}
```

---

**End of `CONFIG_GUIDE.md`.**
