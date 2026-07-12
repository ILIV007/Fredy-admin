/**
 * src/entry/cron.ts
 * Cron handler — runs scheduler tick + source refresh.
 */

import type { Env, Container } from "../types/env";
import { SchedulerOrchestrator } from "../orchestrators/scheduler";
import { processScheduledQueue } from "./cron";

export interface CronHandlerDeps {
  readonly env: Env;
  readonly container: Container;
  readonly ctx: ExecutionContext;
}

export async function cronHandler(
  event: ScheduledEvent,
  deps: CronHandlerDeps,
): Promise<void> {
  const { env, container, ctx } = deps;
  console.log("[cron] tick at " + new Date().toISOString());

  ctx.waitUntil(processScheduledQueue(env, container));
  ctx.waitUntil(
    (async () => {
      const scheduler = new SchedulerOrchestrator(container);
      const result = await scheduler.tick();
      if (result.fired) console.log("[cron] slot fired: " + (result.slot?.category ?? "?"));
      else if (result.skipped) console.log("[cron] skipped: " + (result.skipReason ?? "?"));

      const minute = new Date().getMinutes();
      if (minute % 15 === 0) {
        await scheduler.refreshSources();
        console.log("[cron] source refresh done");
      }
    })(),
  );
}

export async function processScheduledQueue(env: Env, container: Container): Promise<void> {
  const due = await container.kv.listDueScheduled();
  if (due.length === 0) return;

  for (const item of due) {
    try {
      const chatId = item["chatId"] as number | string;
      const text = item["text"] as string;
      const parseMode = item["parseMode"] as string | undefined;
      const mediaType = item["mediaType"] as string | undefined;
      const mediaFileId = item["mediaFileId"] as string | null | undefined;

      const res = await container.tg.publishToChannel(chatId, {
        text,
        mediaType: (mediaType as "photo" | "video" | "animation" | "document" | "none") ?? "none",
        mediaFileId: mediaFileId ?? null,
        extra: parseMode ? { parse_mode: parseMode } : {},
      });

      if (res.ok) {
        await container.kv.deleteScheduledItem(item["_kvKey"] as string);
      } else {
        const permanentErrors = ["chat not found", "bot was blocked", "CHAT_ADMIN_REQUIRED"];
        if (permanentErrors.some((e) => (res.description ?? "").toLowerCase().includes(e.toLowerCase()))) {
          await container.kv.deleteScheduledItem(item["_kvKey"] as string);
        }
      }
    } catch (e) {
      console.error("[cron] exception:", e instanceof Error ? e.message : String(e));
    }
  }

  await container.kv.flushAllStats();
}
