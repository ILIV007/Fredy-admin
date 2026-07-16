/**
 * src/entry/webhook.ts
 * POST /webhook — Telegram update handler.
 *
 * Pattern inherited from AI Admin src/index.js (lines 348-408):
 *   1. Verify webhook secret (if configured).
 *   2. Parse body as JSON.
 *   3. Return 200 IMMEDIATELY.
 *   4. All real work happens inside ctx.waitUntil.
 *
 * This is the correct Cloudflare Workers pattern: Telegram requires 200 within
 * 60 seconds, and the platform can re-deliver updates that don't get a 200.
 * Heavy work (AI calls, source fetches, publishing) goes in the background.
 *
 * See ARCHITECTURE_RULES.md §3.1.
 */

import type { Container, Env } from "../types/env";
import type { TelegramUpdate } from "../types/telegram";
import { AdminOrchestrator } from "../orchestrators/admin";

export interface WebhookHandlerDeps {
  readonly env: Env;
  readonly container: Container;
  readonly ctx: ExecutionContext;
}

export async function webhookHandler(
  request: Request,
  deps: WebhookHandlerDeps,
): Promise<Response> {
  const { env, container, ctx } = deps;

  // Step 1: verify webhook secret (if configured).
  if (env.WEBHOOK_SECRET) {
    const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
    if (secretHeader !== env.WEBHOOK_SECRET) {
      console.warn("[webhook] 403 — secret mismatch");
      // Log the rejected request for the debug dashboard.
      ctx.waitUntil(
        container.logger.rawRequest({
          method: request.method,
          path: "/webhook",
          hasSecret: !!secretHeader,
          secretMatch: false,
          bodySize: 0,
          updateType: "unknown",
          fromId: null,
          chatId: null,
          textPreview: "",
          status: "rejected_403",
          detail: "Webhook secret mismatch",
        }),
      );
      return new Response("Forbidden", { status: 403 });
    }
  }

  // Step 2: parse body.
  let update: TelegramUpdate;
  let bodySize = 0;
  try {
    const text = await request.text();
    bodySize = text.length;
    update = JSON.parse(text) as TelegramUpdate;
  } catch { /* non-fatal */
    console.warn("[webhook] 400 — invalid JSON");
    ctx.waitUntil(
      container.logger.rawRequest({
        method: request.method,
        path: "/webhook",
        hasSecret: !!env.WEBHOOK_SECRET,
        secretMatch: true,
        bodySize,
        updateType: "invalid_json",
        fromId: null,
        chatId: null,
        textPreview: "",
        status: "rejected_400",
        detail: "Invalid JSON body",
      }),
    );
    return new Response("Bad Request", { status: 400 });
  }

  // Extract update info for logging.
  const updateInfo = extractUpdateInfoForLog(update);

  // Step 3: log the raw request (fire-and-forget via waitUntil).
  ctx.waitUntil(
    container.logger.rawRequest({
      method: request.method,
      path: "/webhook",
      hasSecret: !!env.WEBHOOK_SECRET,
      secretMatch: true,
      bodySize,
      updateType: updateInfo.updateType,
      fromId: updateInfo.fromId,
      chatId: updateInfo.chatId,
      textPreview: updateInfo.textPreview,
      status: "ok",
      detail: "processed",
    }),
  );

  // Step 4: dispatch the update in the background, return 200 immediately.
  ctx.waitUntil(
    (async () => {
      try {
        const admin = new AdminOrchestrator(container);
        await admin.dispatch(update);
        // Flush batched stats after every request.
        await container.kv.flushAllStats();
      } catch (error) {
        console.error("[webhook] dispatch error:", error);
        // Try to send error to the user's chat.
        const errMsg = error instanceof Error ? error.message : String(error);
        const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
        if (chatId) {
          await container.tg.sendMessage(chatId, [
            "❌ <b>Webhook Error</b>",
            "",
            `<code>${errMsg.slice(0, 500)}</code>`,
          ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
        }
        await container.logger.error("pipeline.error", {
          error: errMsg,
          stack: error instanceof Error ? error.stack?.split("\n").slice(0, 4) : undefined,
          updateType: updateInfo.updateType,
        }).catch(() => {});
      }
    })(),
  );

  return new Response("ok", { status: 200 });
}

/** Extract a small info blob from an update for logging (avoids logging full bodies). */
function extractUpdateInfoForLog(update: TelegramUpdate): {
  updateType: string;
  fromId: number | null;
  chatId: number | null;
  textPreview: string;
} {
  if (update.callback_query) {
    const cq = update.callback_query;
    return {
      updateType: "callback_query",
      fromId: cq.from?.id ?? null,
      chatId: cq.message?.chat?.id ?? null,
      textPreview: (cq.data ?? "").slice(0, 80),
    };
  }
  if (update.message) {
    return {
      updateType: "message",
      fromId: update.message.from?.id ?? null,
      chatId: update.message.chat?.id ?? null,
      textPreview: (update.message.text ?? update.message.caption ?? "").slice(0, 80),
    };
  }
  if (update.channel_post) {
    return {
      updateType: "channel_post",
      fromId: update.channel_post.from?.id ?? update.channel_post.sender_chat?.id ?? null,
      chatId: update.channel_post.chat?.id ?? null,
      textPreview: (update.channel_post.text ?? update.channel_post.caption ?? "").slice(0, 80),
    };
  }
  if (update.edited_message) {
    return {
      updateType: "edited_message",
      fromId: update.edited_message.from?.id ?? null,
      chatId: update.edited_message.chat?.id ?? null,
      textPreview: (update.edited_message.text ?? "").slice(0, 80),
    };
  }
  return { updateType: "other", fromId: null, chatId: null, textPreview: "" };
}
