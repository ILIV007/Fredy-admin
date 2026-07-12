/**
 * src/services/language-injector.ts
 * Injects per-language rules into the AI system prompt.
 *
 * The AI must generate DIRECTLY in the selected language (never translate).
 * This module provides the writing rules for each supported language.
 */

import type { LanguageConfig } from "../core/config/sections/language";

export interface LanguageInjectorDeps {
  readonly config: () => Promise<LanguageConfig>;
}

export class LanguageInjector {
  constructor(private readonly deps: LanguageInjectorDeps) {}

  /** Get the language rules string for the requested language. */
  async getRules(requestedLanguage: string): Promise<string> {
    const config = await this.deps.config();
    const actual = requestedLanguage === "auto" ? config.default : requestedLanguage;

    if (actual === "fa") return PERSIAN_RULES;
    if (actual === "en") return ENGLISH_RULES;
    return ENGLISH_RULES; // fallback
  }

  /** Resolve "auto" to a concrete language. */
  async resolve(requestedLanguage: string): Promise<"en" | "fa"> {
    const config = await this.deps.config();
    if (requestedLanguage !== "auto") {
      return requestedLanguage as "en" | "fa";
    }
    return config.default === "fa" ? "fa" : "en";
  }
}

const ENGLISH_RULES = `LANGUAGE: English
- Write naturally, like a knowledgeable friend sharing something interesting.
- Use contractions (it's, don't, you'll).
- Vary sentence length — short for impact, long for explanation.
- Never use AI cliché phrases ("in today's world", "it is worth noting", "as an AI").
- Never sound corporate, robotic, or like a news agency.
- Never sound like marketing.`;

const PERSIAN_RULES = `LANGUAGE: Persian (فارسی)
- Write in colloquial Persian (محاوره‌ای), not formal (کتابی).
- Use half-spaces (نیم‌فاصله) correctly: "توسعه‌دهنده", "هوش‌مصنوعی", "می‌رود".
- Keep technical terms in English: GitHub, API, worker, prompt, deploy, commit.
- Use natural code-switching between Persian and English technical terms.
- Never translate technical terms that have no standard Persian equivalent.
- Vary sentence length.
- Never sound like a news agency or a textbook.`;
