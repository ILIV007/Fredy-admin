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

  /** Dequeue the oldest item for a category. */
  async dequeue(category: Category): Promise<QueuedContent | null> {
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
      return this.dequeue(category); // Try the next one.
    }

    await this.saveQueue(category, queue);
    return item;
  }

  /** Peek at the oldest item without removing it. */
  async peek(category: Category): Promise<QueuedContent | null> {
    const queue = await this.getQueue(category);
    return queue[0] ?? null;
  }

  /** Get queue depth per category.
   *  v7.4.1: Now counts ONLY non-expired, valid items (consistent with
   *  listItems()). Previously it counted raw queue length including
   *  expired items, which made the dashboard show "11 / 9" but the items
   *  table was empty — confusing the admin. */
  async depth(): Promise<readonly QueueDepth[]> {
    const categories: Category[] = ["A", "B", "C"];
    const now = Date.now();
    const depths = await Promise.all(
      categories.map(async (cat) => {
        const queue = await this.getQueue(cat);
        // Filter to valid, non-expired items — same logic as listItems().
        const valid = queue.filter((item) => {
          try {
            return item && typeof item === "object"
              && item.expiresAt > now
              && item.content && item.content.id;
          } catch { return false; }
        });
        const oldest = valid[0];
        return {
          category: cat,
          depth: valid.length,
          oldestItemAge: oldest ? now - oldest.enqueuedAt : null,
        } satisfies QueueDepth;
      }),
    );
    return depths;
  }

  /** Get depth for a single category (counts only non-expired items). */
  async depthFor(category: Category): Promise<number> {
    const queue = await this.getQueue(category);
    const now = Date.now();
    return queue.filter((item) => {
      try {
        return item && item.expiresAt > now && item.content && item.content.id;
      } catch { return false; }
    }).length;
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

  /** Get all items in a category queue (for dashboard display).
   *  v7.4.1: Also triggers a background cleanup of expired items so the
   *  KV store doesn't accumulate stale entries. */
  async listItems(category: Category): Promise<QueuedContent[]> {
    const queue = await this.getQueue(category);
    const now = Date.now();
    // Per-item filter: reject expired or malformed items.
    const valid: QueuedContent[] = [];
    const expired: QueuedContent[] = [];
    for (const item of queue) {
      try {
        if (!item || typeof item !== "object") continue;
        if (item.expiresAt <= now) { expired.push(item); continue; }
        if (!item.content || !item.content.id) continue;
        if (!item.content.category) continue;
        // Patch missing quality (legacy items).
        if (!item.content.quality || typeof item.content.quality.overallScore !== "number") {
          (item.content as { quality: { overallScore: number } }).quality = { overallScore: 0 };
        }
        valid.push(item);
      } catch {
        // skip bad item
      }
    }
    // Background cleanup: if expired items were found, rewrite the queue
    // without them. This keeps the KV store tidy without blocking the response.
    if (expired.length > 0) {
      // Don't await — fire and forget.
      this.saveQueue(category, valid).catch(() => {});
    }
    return valid;
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
