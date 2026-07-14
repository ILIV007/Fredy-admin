/**
 * src/plugins/ai/gemini.ts
 * Google Gemini AI provider. Real implementation.
 *
 * Calls the Gemini generateContent API. Returns the AI's text response.
 * Respects the AbortSignal for timeout/cancellation.
 *
 * Reused pattern from AI Admin src/ai.js geminiComplete().
 */

import type { AIProvider } from "../../types/plugin";
import type { AICompleteRequest, AICompleteResponse } from "../../types/ai";
import type { Env } from "../../types/env";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const GEMINI_MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
] as const;

export class GeminiProvider implements AIProvider {
  readonly id = "gemini";
  readonly name = "Google Gemini";
  readonly models = GEMINI_MODELS;

  constructor(private readonly env: Env) {}

  isConfigured(env: Env): boolean {
    return !!env.GEMINI_API_KEY;
  }

  async complete(
    request: AICompleteRequest,
    signal: AbortSignal,
  ): Promise<AICompleteResponse> {
    if (!this.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not set");
    }

    const model = request.model ?? this.models[0]!;
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${this.env.GEMINI_API_KEY}`;
    const startTime = Date.now();

    const body = {
      systemInstruction: request.system ? { parts: [{ text: request.system }] } : undefined,
      contents: [{ role: "user", parts: [{ text: request.user }] }],
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        topP: 0.9,
        maxOutputTokens: request.maxTokens ?? 3096,
        ...(request.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Gemini ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: { totalTokenCount?: number };
    };

    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("") ?? "";

    if (!text || !text.trim()) {
      const reason = data.candidates?.[0]?.finishReason;
      throw new Error(`Gemini returned empty response (finishReason: ${reason ?? "unknown"})`);
    }

    const latencyMs = Date.now() - startTime;
    const tokensUsed = data.usageMetadata?.totalTokenCount;

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
