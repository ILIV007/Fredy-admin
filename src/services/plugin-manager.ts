/**
 * src/services/plugin-manager.ts
 * Central plugin manager for content source plugins.
 *
 * Responsibilities:
 *   - Register/unregister plugins
 *   - Enable/disable plugins at runtime (disabled plugins never execute)
 *   - Reload a plugin (re-instantiate from factory)
 *   - List all plugins with metadata and status
 *   - Run health checks on one or all plugins
 *   - Fetch items from the best available plugin for a category
 *   - Track per-plugin status (success/failure counts, rate limits)
 *
 * Core NEVER depends on a specific plugin. It depends on this manager.
 * See ARCHITECTURE_RULES.md §5 (Plugin First).
 */

import { sourceHealthKey } from "../core/storage/keys";
import { validatePlugin } from "../core/plugin/validator";
import {
  PluginAlreadyRegisteredError,
  PluginDisabledError,
  PluginError,
  PluginFetchError,
  PluginNotRegisteredError,
} from "../core/plugin/errors";
import type { Category } from "../types/category";
import type { Plugin, PluginManifest, PluginStatus } from "../types/plugin";
import type { SourceItem } from "../types/api";
import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";

export interface PluginManagerDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
}

/** Factory function that creates a plugin instance. Used for reload. */
export type PluginFactory = () => Plugin;

/** Internal entry tracking a plugin, its factory, and runtime enabled state. */
interface PluginEntry {
  readonly plugin: Plugin;
  readonly factory: PluginFactory;
  /** Runtime enabled state (overrides manifest.enabled). */
  enabled: boolean;
}

function defaultStatus(pluginId: string): PluginStatus {
  return {
    pluginId,
    healthy: true,
    enabled: true,
    lastFetchAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    consecutiveFailures: 0,
    totalFetches: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    rateLimitRemaining: null,
    rateLimitResetAt: null,
    lastItemCount: null,
  };
}

export class PluginManager {
  private readonly entries = new Map<string, PluginEntry>();
  private readonly statuses = new Map<string, PluginStatus>();

  constructor(private readonly deps: PluginManagerDeps) {}

  // ────────────────────────────────────────────────────────────
  // Registration
  // ────────────────────────────────────────────────────────────

  /**
   * Register a plugin. The factory is stored for reload.
   * Throws if the plugin fails interface validation or if the ID is taken.
   */
  register(factory: PluginFactory): void {
    const plugin = factory();
    validatePlugin(plugin);

    const id = plugin.metadata.id;
    if (this.entries.has(id)) {
      throw new PluginAlreadyRegisteredError(id);
    }

    this.entries.set(id, {
      plugin,
      factory,
      enabled: plugin.metadata.enabled,
    });
    this.statuses.set(id, defaultStatus(id));

    this.deps.logger.info("source.fetch_start", {
      pluginId: id,
      message: `Plugin "${id}" registered`,
    });
  }

  /** Unregister a plugin. Removes it entirely. */
  unregister(id: string): void {
    if (!this.entries.has(id)) {
      throw new PluginNotRegisteredError(id);
    }
    this.entries.delete(id);
    this.statuses.delete(id);
    // Clear persisted status from KV.
    void this.deps.kv.delete(sourceHealthKey(id));
    this.deps.logger.info("source.fetch_start", {
      pluginId: id,
      message: `Plugin "${id}" unregistered`,
    });
  }

  // ────────────────────────────────────────────────────────────
  // Enable / Disable
  // ────────────────────────────────────────────────────────────

  /** Enable a plugin at runtime. */
  enable(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new PluginNotRegisteredError(id);
    entry.enabled = true;
    this.updateStatus(id, { enabled: true });
  }

  /** Disable a plugin at runtime. Disabled plugins never execute. */
  disable(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new PluginNotRegisteredError(id);
    entry.enabled = false;
    this.updateStatus(id, { enabled: false });
  }

  /** Check if a plugin is currently enabled. */
  isEnabled(id: string): boolean {
    const entry = this.entries.get(id);
    return entry?.enabled ?? false;
  }

  // ────────────────────────────────────────────────────────────
  // Reload
  // ────────────────────────────────────────────────────────────

  /**
   * Reload a plugin — re-instantiate from the factory.
   * Useful if the plugin's config changed.
   * Preserves the enabled state.
   */
  reload(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new PluginNotRegisteredError(id);

    const wasEnabled = entry.enabled;
    const newPlugin = entry.factory();
    validatePlugin(newPlugin);

    this.entries.set(id, {
      plugin: newPlugin,
      factory: entry.factory,
      enabled: wasEnabled,
    });

    this.deps.logger.info("source.fetch_start", {
      pluginId: id,
      message: `Plugin "${id}" reloaded`,
    });
  }

  // ────────────────────────────────────────────────────────────
  // Listing & Lookup
  // ────────────────────────────────────────────────────────────

  /** Get a plugin by ID. Returns null if not registered. */
  get(id: string): Plugin | null {
    return this.entries.get(id)?.plugin ?? null;
  }

  /** List all registered plugins. */
  list(): readonly Plugin[] {
    return Array.from(this.entries.values()).map((e) => e.plugin);
  }

  /** List plugins for a specific category. */
  listByCategory(category: Category): readonly Plugin[] {
    return this.list().filter((p) => p.getCategory() === category);
  }

  /** List enabled plugins for a category, sorted by priority. */
  listEnabledForCategory(category: Category): readonly Plugin[] {
    return this.list()
      .filter((p) => p.getCategory() === category)
      .filter((p) => this.isEnabled(p.metadata.id))
      .sort((a, b) => a.metadata.priority - b.metadata.priority);
  }

  /** Get all manifests (metadata only). */
  manifests(): readonly PluginManifest[] {
    return this.list().map((p) => p.metadata);
  }

  // ────────────────────────────────────────────────────────────
  // Health Check
  // ────────────────────────────────────────────────────────────

  /** Run health check on a single plugin. Updates status. */
  async healthCheck(id: string): Promise<PluginStatus> {
    const entry = this.entries.get(id);
    if (!entry) throw new PluginNotRegisteredError(id);

    try {
      const status = await entry.plugin.health();
      this.statuses.set(id, status);
      await this.persistStatus(id, status);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = this.updateStatus(id, {
        healthy: false,
        lastErrorAt: Date.now(),
        lastErrorMessage: message,
      });
      return status;
    }
  }

  /** Run health checks on all plugins in parallel. */
  async healthCheckAll(): Promise<readonly PluginStatus[]> {
    const ids = Array.from(this.entries.keys());
    return Promise.all(ids.map((id) => this.healthCheck(id).catch(() => defaultStatus(id))));
  }

  /** Get cached status for a plugin (does not run a new health check). */
  getStatus(id: string): PluginStatus {
    return this.statuses.get(id) ?? defaultStatus(id);
  }

  /** Get all cached statuses. */
  getAllStatuses(): readonly PluginStatus[] {
    return Array.from(this.statuses.values());
  }

  // ────────────────────────────────────────────────────────────
  // Fetching
  // ────────────────────────────────────────────────────────────

  /**
   * Fetch items from a specific plugin.
   * Disabled plugins never execute — throws PluginDisabledError.
   */
  async fetchFrom(id: string): Promise<readonly SourceItem[]> {
    const entry = this.entries.get(id);
    if (!entry) throw new PluginNotRegisteredError(id);
    if (!entry.enabled) throw new PluginDisabledError(id);

    const startTime = Date.now();
    this.updateStatus(id, { lastFetchAt: startTime });

    try {
      const items = await entry.plugin.fetch();
      const durationMs = Date.now() - startTime;

      this.updateStatus(id, {
        healthy: true,
        lastSuccessAt: Date.now(),
        lastErrorAt: null,
        lastErrorMessage: null,
        consecutiveFailures: 0,
        totalFetches: this.getStatus(id).totalFetches + 1,
        totalSuccesses: this.getStatus(id).totalSuccesses + 1,
        totalFailures: this.getStatus(id).totalFailures,
        lastItemCount: items.length,
      });

      this.deps.logger.info("source.fetch_success", {
        pluginId: id,
        itemCount: items.length,
        durationMs,
      });

      return items;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateStatus(id, {
        healthy: false,
        lastErrorAt: Date.now(),
        lastErrorMessage: message,
        consecutiveFailures: this.getStatus(id).consecutiveFailures + 1,
        totalFetches: this.getStatus(id).totalFetches + 1,
        totalSuccesses: this.getStatus(id).totalSuccesses,
        totalFailures: this.getStatus(id).totalFailures + 1,
        lastItemCount: 0,
      });

      this.deps.logger.error("source.fetch_error", {
        pluginId: id,
        error: message,
        durationMs: Date.now() - startTime,
      });

      throw new PluginFetchError(id, message);
    }
  }

  /**
   * Fetch items for a category. Picks the best available plugin
   * (enabled, healthy, highest priority). Respects anti-repeat
   * (skips lastSource if possible).
   */
  async fetchForCategory(
    category: Category,
    lastSource: string | null = null,
  ): Promise<{ readonly source: string; readonly items: readonly SourceItem[] } | null> {
    const candidates = this.listEnabledForCategory(category);
    if (candidates.length === 0) return null;

    // Move lastSource to the end of the candidate list (anti-repeat).
    const ordered = lastSource
      ? [...candidates.filter((p) => p.metadata.id !== lastSource), ...candidates.filter((p) => p.metadata.id === lastSource)]
      : candidates;

    for (const plugin of ordered) {
      try {
        const items = await this.fetchFrom(plugin.metadata.id);
        if (items.length > 0) {
          return { source: plugin.metadata.id, items };
        }
      } catch (error) {
        // Try the next plugin.
        if (error instanceof PluginError) {
          this.deps.logger.warn("source.fetch_error", {
            pluginId: plugin.metadata.id,
            error: error.message,
            message: "Trying next plugin",
          });
        }
      }
    }

    return null;
  }

  /** Fetch one item from a specific plugin (for manual triggers). */
  async fetchOne(id: string): Promise<SourceItem | null> {
    const items = await this.fetchFrom(id);
    return items[0] ?? null;
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  /** Update the in-memory status. Returns the new status. */
  private updateStatus(id: string, patch: Partial<PluginStatus>): PluginStatus {
    const current = this.getStatus(id);
    const next: PluginStatus = { ...current, ...patch, pluginId: id };
    this.statuses.set(id, next);
    void this.persistStatus(id, next);
    return next;
  }

  /** Persist status to KV (fire-and-forget). */
  private async persistStatus(id: string, status: PluginStatus): Promise<void> {
    try {
      await this.deps.kv.setJson(sourceHealthKey(id), status);
    } catch { /* non-fatal */
      // KV write failures are non-fatal for status tracking.
    }
  }
}
