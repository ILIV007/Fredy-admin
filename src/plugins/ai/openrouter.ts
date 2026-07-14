/**
 * src/plugins/ai/openrouter.ts
 * OpenRouter AI provider. Real implementation.
 *
 * Calls the OpenRouter chat completions API. Returns the AI's text response.
 * Respects the AbortSignal for timeout/cancellation.
 *
 * Reused pattern from AI Admin src/ai.js openRouterComplete().
 */

import type { AIProvider } from "../../types/plugin";
import type { AICompleteRequest, AICompleteResponse } from "../../types/ai";
import type { Env } from "../../types/env";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const OPENROUTER_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "google/gemma-4-31b-it:free",
  "openai/gpt-oss-120b:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
] as const;

export class OpenRouterProvider implements AIProvider {
  readonly id = "openrouter";
  readonly name = "OpenRouter";
  readonly models = OPENROUTER_MODELS;

  constructor(private readonly env: Env) {}

  isConfigured(env: Env): boolean {
    return !!env.OPENROUTER_API_KEY;
  }

  async complete(
    request: AICompleteRequest,
    signal: AbortSignal,
  ): Promise<AICompleteResponse> {
    if (!this.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY not set");
    }

    const model = request.model ?? this.models[0]!;
    const startTime = Date.now();

    const body = {
      model,
      messages: [
        ...(request.system ? [{ role: "system", content: request.system }] : []),
        { role: "user", content: request.user },
      ],
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 3096,
      ...(request.jsonMode ? { response_format: { type: "json_object" } } : {}),
    };

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://fredy.workers.dev",
        "X-Title": "Fredy",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`OpenRouter ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: { total_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? "";

    if (!text || !text.trim()) {
      const reason = data.choices?.[0]?.finish_reason;
      throw new Error(`OpenRouter returned empty response (finish_reason: ${reason ?? "unknown"})`);
    }

    const latencyMs = Date.now() - startTime;
    const tokensUsed = data.usage?.total_tokens;

    return {
      ok: true,
      text: text.trim(),
      provider: this.id,
      model,
      tokensUsed,
      latencyMs,
    };
  }
}
