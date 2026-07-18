/**
 * src/services/content-queue.ts
 * Ready queue — stores processed ReadyContent items waiting for the scheduler.
 *
 * Each category has its own queue (FIFO). Items expire after 24 hours.
 * See ARCHITECTURE_RULES.md §7.1 (fredy:queue:<category>) and Prompt 8 spec.
 */

import { queueKey, dlqKey } from "../core/storage/keys";
import { MS_PER_DAY } from "../core/constants";
import type { Category } from "../types/category";
import type { QueuedContent, QueueDepth, ReadyContent } from "../types/content";
import type { DeadLetterItem } from "../types/queue";
import type { KVStore } from "./kv-store";
import type { Logger } from "./logger";

export interface ContentQueueDeps {
  readonly kv: KVStore;
  readonly logger: Logger;
}

/** Queue item TTL (24 hours). */
const ITEM_TTL_SECONDS = MS_PER_DAY / 1000;

/** Maximum items per category queue. */
const MAX_QUEUE_DEPTH = 50;

export class ContentQueue {
  constructor(private readonly deps: ContentQueueDeps) {}

  /** Enqueue a ready content item. */
  async enqueue(content: ReadyContent): Promise<QueuedContent> {
    const now = Date.now();
    const queued: QueuedContent = {
      id: content.id,
      category: content.category,
      content,
      enqueuedAt: now,
      expiresAt: now + ITEM_TTL_SECONDS * 1000,
      attempts: 0,
      lastAttemptAt: null,
    };

    const queue = await this.getQueue(content.category);
    queue.push(queued);

    // Cap the queue depth (drop oldest if exceeded).
    if (queue.length > MAX_QUEUE_DEPTH) {
      const dropped = queue.shift();
      if (dropped) {
        this.deps.logger.warn("quality.reject", {
          contentId: dropped.id,
          category: dropped.category,
          reason: "queue_overflow",
          message: "Queue full, dropping oldest item",
        });
      }
    }

    await this.saveQueue(content.category, queue);

    this.deps.logger.info("pipeline.complete", {
      contentId: content.id,
      category: content.category,
      queueDepth: queue.length,
      message: "Content enqueued",
    });

    return queued;
  }

  /** Dequeue the oldest item for a category.
   *  v8.0.0: Wrapped in a per-category lock to prevent concurrent dequeues
   *  racing on the same KV key. */
  async dequeue(category: Category): Promise<QueuedContent | null> {
    const release = await this.acquireQueueLock(category);
    try {
      return await this.dequeueLocked(category);
    } finally {
      await release();
    }
  }

  /** Internal: dequeue without re-acquiring the lock (caller holds the lock). */
  private async dequeueLocked(category: Category): Promise<QueuedContent | null> {
    const queue = await this.getQueue(category);
    if (queue.length === 0) return null;

    const item = queue.shift();
    if (!item) return null;

    // Check if expired.
    if (Date.now() > item.expiresAt) {
      this.deps.logger.warn("quality.reject", {
        contentId: item.id,
        category: item.category,
        reason: "expired",
      });
      await this.saveQueue(category, queue);
      return this.dequeueLocked(category); // Try the next one.
    }

    await this.saveQueue(category, queue);
    return item;
  }

  /** Acquire a per-category queue lock. Returns a release function. */
  private async acquireQueueLock(category: Category): Promise<() => Promise<void>> {
    const key = `fredy:queue:lock:${category}`;
    const maxAttempts = 30;
    const delayMs = 100;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const existing = await this.deps.kv.get(key);
        if (!existing) {
          await this.deps.kv.set(key, String(Date.now()), 10);
          return async () => {
            try { await this.deps.kv.delete(key); } catch { /* non-fatal */ }
          };
        }
      } catch {
        // On KV error, allow execution (no-op release).
        return async () => {};
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    // Timed out waiting for lock — proceed anyway with no-op release.
    this.deps.logger.warn("pipeline.warn", {
      category,
      reason: "queue_lock_timeout",
      message: "Queue lock acquisition timed out — proceeding without lock",
    });
    return async () => {};
  }

  /** Peek at the oldest item without removing it. */
  async peek(category: Category): Promise<QueuedContent | null> {
    const queue = await this.getQueue(category);
    return queue[0] ?? null;
  }

  /** Get queue depth per category. */
  async depth(): Promise<readonly QueueDepth[]> {
    const categories: Category[] = ["A", "B", "C"];
    const depths = await Promise.all(
      categories.map(async (cat) => {
        const queue = await this.getQueue(cat);
        const oldest = queue[0];
        return {
          category: cat,
          depth: queue.length,
          oldestItemAge: oldest ? Date.now() - oldest.enqueuedAt : null,
        } satisfies QueueDepth;
      }),
    );
    return depths;
  }

  /** Get depth for a single category. */
  async depthFor(category: Category): Promise<number> {
    const queue = await this.getQueue(category);
    return queue.length;
  }

  /** Move an item to the dead-letter queue. */
  async moveToDlq(item: QueuedContent, error: string): Promise<DeadLetterItem> {
    const dlqItem: DeadLetterItem = {
      id: item.id,
      category: item.category,
      source: item.content.pluginId,
      sourceItem: {
        id: item.id,
        source: item.content.pluginId,
        category: item.category,
        title: item.content.headline ?? "",
        body: item.content.text,
        url: item.content.sourceUrl,
        fetchedAt: item.content.fetchedAt,
      },
      firstAttemptAt: item.enqueuedAt,
      lastAttemptAt: Date.now(),
      failureCount: item.attempts + 1,
      lastError: error,
    };

    const dlq = await this.getDlq(item.category);
    dlq.unshift(dlqItem);

    // Cap DLQ at 20 items.
    if (dlq.length > 20) {
      dlq.length = 20;
    }

    await this.saveDlq(item.category, dlq);

    this.deps.logger.error("pipeline.error", {
      contentId: item.id,
      category: item.category,
      error,
      failureCount: dlqItem.failureCount,
      message: "Moved to dead-letter queue",
    });

    return dlqItem;
  }

  /** List dead-letter items for a category. */
  async listDlq(category?: Category): Promise<readonly DeadLetterItem[]> {
    if (category) {
      return this.getDlq(category);
    }
    const all = await Promise.all([
      this.getDlq("A"),
      this.getDlq("B"),
      this.getDlq("C"),
    ]);
    return [...all[0], ...all[1], ...all[2]];
  }

  /** Get all items in a category queue (for dashboard display). */
  async listItems(category: Category): Promise<QueuedContent[]> {
    const queue = await this.getQueue(category);
    // Filter out expired items.
    const now = Date.now();
    return queue.filter((item) => item.expiresAt > now);
  }

  /** Delete a specific item from a category queue by content ID. */
  async deleteItem(category: Category, contentId: string): Promise<boolean> {
    const queue = await this.getQueue(category);
    const filtered = queue.filter((item) => item.content.id !== contentId);
    if (filtered.length === queue.length) return false; // Not found.
    await this.saveQueue(category, filtered);
    return true;
  }

  /** Clear the queue for a category. */
  async clear(category: Category): Promise<void> {
    await this.deps.kv.delete(queueKey(category));
  }

  /** Clear all queues. */
  async clearAll(): Promise<void> {
    await Promise.all([
      this.clear("A"),
      this.clear("B"),
      this.clear("C"),
    ]);
  }

  // ────────────────────────────────────────────────────────────
  // Internal: queue I/O
  // ────────────────────────────────────────────────────────────

  private async getQueue(category: Category): Promise<QueuedContent[]> {
    const queue = await this.deps.kv.getJson<QueuedContent[]>(queueKey(category));
    return queue ?? [];
  }

  private async saveQueue(category: Category, queue: QueuedContent[]): Promise<void> {
    await this.deps.kv.setJson(queueKey(category), queue, ITEM_TTL_SECONDS);
  }

  private async getDlq(category: Category): Promise<DeadLetterItem[]> {
    const dlq = await this.deps.kv.getJson<DeadLetterItem[]>(dlqKey(category));
    return dlq ?? [];
  }

  private async saveDlq(category: Category, dlq: DeadLetterItem[]): Promise<void> {
    await this.deps.kv.setJson(dlqKey(category), dlq);
  }
}
