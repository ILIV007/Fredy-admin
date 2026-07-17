/**
 * src/services/provider-registry.ts
 * Registry for AI provider plugins. Separate from PluginManager because
 * AI providers have a different interface (AIProvider) and different
 * lifecycle (no fetch/normalize/validate, just complete()).
 *
 * See ARCHITECTURE_RULES.md §5 (Plugin First).
 */

import type { AIProvider } from "../types/plugin";
import type { AICompleteRequest, AICompleteResponse } from "../types/ai";
import type { Env } from "../types/env";
import type { Logger } from "./logger";

export interface ProviderRegistryDeps {
  readonly logger: Logger;
  readonly env: Env;
}

/** Internal entry tracking a provider and its runtime enabled state. */
interface ProviderEntry {
  readonly provider: AIProvider;
  enabled: boolean;
  priority: number;
}

export class ProviderRegistry {
  private readonly entries = new Map<string, ProviderEntry>();

  constructor(private readonly deps: ProviderRegistryDeps) {}

  // ────────────────────────────────────────────────────────────
  // Registration
  // ────────────────────────────────────────────────────────────

  /** Register an AI provider. */
  register(provider: AIProvider, priority = 10): void {
    if (this.entries.has(provider.id)) {
      throw new Error(`AI provider "${provider.id}" already registered`);
    }
    this.entries.set(provider.id, {
      provider,
      enabled: provider.isConfigured(this.deps.env),
      priority,
    });
    this.deps.logger.info("ai.start", {
      providerId: provider.id,
      message: `AI provider "${provider.id}" registered`,
    });
  }

  /** Unregister an AI provider. */
  unregister(id: string): void {
    if (!this.entries.has(id)) {
      throw new Error(`AI provider "${id}" not registered`);
    }
    this.entries.delete(id);
  }

  // ────────────────────────────────────────────────────────────
  // Enable / Disable
  // ────────────────────────────────────────────────────────────

  enable(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`AI provider "${id}" not registered`);
    entry.enabled = true;
  }

  disable(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`AI provider "${id}" not registered`);
    entry.enabled = false;
  }

  isEnabled(id: string): boolean {
    return this.entries.get(id)?.enabled ?? false;
  }

  // ────────────────────────────────────────────────────────────
  // Listing & Lookup
  // ────────────────────────────────────────────────────────────

  /** Get a provider by ID. */
  get(id: string): AIProvider | null {
    return this.entries.get(id)?.provider ?? null;
  }

  /** List all registered providers. */
  list(): readonly AIProvider[] {
    return Array.from(this.entries.values()).map((e) => e.provider);
  }

  /** List enabled providers, sorted by priority. */
  listEnabled(): readonly AIProvider[] {
    return Array.from(this.entries.values())
      .filter((e) => e.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map((e) => e.provider);
  }

  /** List providers with their status (enabled, priority, configured). */
  listWithStatus(): ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly priority: number;
    readonly configured: boolean;
    readonly modelCount: number;
  }> {
    return Array.from(this.entries.values()).map((e) => ({
      id: e.provider.id,
      name: e.provider.name,
      enabled: e.enabled,
      priority: e.priority,
      configured: e.provider.isConfigured(this.deps.env),
      modelCount: e.provider.models.length,
    }));
  }

  // ────────────────────────────────────────────────────────────
  // Execution
  // ────────────────────────────────────────────────────────────

  /**
   * Complete a request using the preferred provider, with fallback.
   * Tries the preferred provider first, then falls back to other enabled providers.
   */
  async complete(
    request: AICompleteRequest,
    preferredId?: string,
  ): Promise<AICompleteResponse> {
    const enabled = this.listEnabled();
    if (enabled.length === 0) {
      throw new Error("No AI providers enabled");
    }

    // Order: preferred first, then by priority.
    const ordered = preferredId
      ? [enabled.find((p) => p.id === preferredId), ...enabled.filter((p) => p.id !== preferredId)].filter(Boolean)
      : enabled;

    const errors: string[] = [];
    for (const provider of ordered) {
      if (!provider) continue;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), request.maxTokens ? 30000 : 15000);
        try {
          const response = await provider.complete(request, controller.signal);
          clearTimeout(timeout);
          return response;
        } catch (error) {
          clearTimeout(timeout);
          throw error;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${provider.id}: ${message}`);
        this.deps.logger.warn("ai.error", {
          providerId: provider.id,
          error: message,
          message: "Falling back to next provider",
        });
      }
    }

    throw new Error(`All AI providers failed: ${errors.join(" | ")}`);
  }

  /** Set priority for a provider (lower = higher priority). */
  setPriority(id: string, priority: number): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`AI provider "${id}" not registered`);
    entry.priority = priority;
  }
}
