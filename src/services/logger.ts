/**
 * src/services/logger.ts
 * Structured logger with conditional KV ring buffer writes.
 *
 * Pattern inherited from AI Admin src/debug.js (lines 5408-5545):
 *   - console.log/error always fires (visible in Cloudflare dashboard).
 *   - KV ring buffer writes only when debug mode is on (saves the 1 000 KV writes/day budget).
 *   - Each ring buffer holds the latest 30 entries (oldest evicted on overflow).
 *
 * See ARCHITECTURE_RULES.md §10.
 */

import { DEBUG_RING_BUFFER_CAPACITY } from "../core/constants";
import { debugErrorsKey, debugUpdatesKey, debugRawKey } from "../core/storage/keys";
import type { DebugEvent, DebugEventName } from "../types/debug";

export interface LoggerDeps {
  readonly kv: KVNamespace;
  readonly isDebugMode: () => boolean;
}

/** Ring buffer entry type (DebugEvent with KV key). */
interface BufferedEvent extends DebugEvent {}

export class Logger {
  constructor(private readonly deps: LoggerDeps) {}

  /** Log an error event. Errors always go to console.error; KV only if debug. */
  async error(event: DebugEventName, context: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await this.log({ level: "error", event, context }, debugErrorsKey());
  }

  /** Log a warning event. */
  async warn(event: DebugEventName, context: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await this.log({ level: "warn", event, context }, debugErrorsKey());
  }

  /** Log an info event. */
  async info(event: DebugEventName, context: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await this.log({ level: "info", event, context }, debugUpdatesKey());
  }

  /** Log a debug event. Only fires when debug mode is on. */
  async debug(event: DebugEventName, context: Readonly<Record<string, unknown>> = {}): Promise<void> {
    if (!this.deps.isDebugMode()) return;
    await this.log({ level: "debug", event, context }, debugUpdatesKey());
  }

  /** Log a raw webhook request (always console.log; KV only if debug). */
  async rawRequest(
    info: {
      readonly method: string;
      readonly path: string;
      readonly hasSecret: boolean;
      readonly secretMatch: boolean;
      readonly bodySize: number;
      readonly updateType: string;
      readonly fromId: number | null;
      readonly chatId: number | null;
      readonly textPreview: string;
      readonly status: string;
      readonly detail: string;
    },
  ): Promise<void> {
    const consoleMsg = `[rawReq] ${info.method} ${info.path} | ${info.updateType} | ${info.status}`;
    console.log(consoleMsg);
    if (!this.deps.isDebugMode()) return;

    const entry: BufferedEvent = {
      time: Date.now(),
      level: "info",
      event: "source.fetch_start", // closest event name; raw requests aren't in the enum
      context: info as unknown as Readonly<Record<string, unknown>>,
    };
    await this.pushToRingBuffer(debugRawKey(), entry);
  }

  // ────────────────────────────────────────────────────────────
  // Internal: write to console + optionally to KV ring buffer
  // ────────────────────────────────────────────────────────────

  private async log(
    event: Omit<DebugEvent, "time">,
    ringBufferKey: string,
  ): Promise<void> {
    const full: DebugEvent = { ...event, time: Date.now() };

    // Always log to console (visible in Cloudflare dashboard).
    const consoleMsg = `[${full.level}] ${full.event} ${this.safeStringify(full.context)}`;
    if (full.level === "error") {
      console.error(consoleMsg);
    } else if (full.level === "warn") {
      console.warn(consoleMsg);
    } else {
      console.log(consoleMsg);
    }

    // KV ring buffer only when debug mode is on.
    if (!this.deps.isDebugMode()) return;
    await this.pushToRingBuffer(ringBufferKey, full);
  }

  /** Push an entry to a KV ring buffer (cap at DEBUG_RING_BUFFER_CAPACITY). */
  private async pushToRingBuffer(key: string, entry: BufferedEvent): Promise<void> {
    try {
      const raw = await this.deps.kv.get(key);
      const list: BufferedEvent[] = raw ? (JSON.parse(raw) as BufferedEvent[]) : [];
      list.unshift(entry);
      // Cap the buffer (drop oldest from the end).
      if (list.length > DEBUG_RING_BUFFER_CAPACITY) {
        list.length = DEBUG_RING_BUFFER_CAPACITY;
      }
      await this.deps.kv.put(key, JSON.stringify(list));
    } catch (error) {
      // Logging failures must never crash the worker.
      console.error("[logger] ring buffer write failed:", error instanceof Error ? error.message : error);
    }
  }

  /** Stringify JSON, but never throw on circular references. */
  private safeStringify(obj: unknown): string {
    try {
      return JSON.stringify(obj);
    } catch {
      return "[unserializable]";
    }
  }

  // ────────────────────────────────────────────────────────────
  // Readers (used by the debug dashboard)
  // ────────────────────────────────────────────────────────────

  async getRecentUpdates(): Promise<readonly DebugEvent[]> {
    return this.readRingBuffer(debugUpdatesKey());
  }

  async getRecentErrors(): Promise<readonly DebugEvent[]> {
    return this.readRingBuffer(debugErrorsKey());
  }

  async getRecentRawRequests(): Promise<readonly DebugEvent[]> {
    return this.readRingBuffer(debugRawKey());
  }

  private async readRingBuffer(key: string): Promise<readonly DebugEvent[]> {
    try {
      const raw = await this.deps.kv.get(key);
      return raw ? (JSON.parse(raw) as DebugEvent[]) : [];
    } catch {
      return [];
    }
  }

  /** Clear all ring buffers. */
  async clear(): Promise<void> {
    await Promise.all([
      this.deps.kv.delete(debugUpdatesKey()),
      this.deps.kv.delete(debugErrorsKey()),
      this.deps.kv.delete(debugRawKey()),
    ]);
  }

  /** Count entries in each ring buffer (for the status endpoint). */
  async counts(): Promise<{ updates: number; errors: number; rawRequests: number }> {
    const [updates, errors, rawRequests] = await Promise.all([
      this.getRecentUpdates(),
      this.getRecentErrors(),
      this.getRecentRawRequests(),
    ]);
    return {
      updates: updates.length,
      errors: errors.length,
      rawRequests: rawRequests.length,
    };
  }
}
