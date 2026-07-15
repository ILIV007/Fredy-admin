/**
 * src/services/language-injector.ts
 * Injects per-language rules into the AI system prompt.
 *
 * The AI must generate DIRECTLY in the selected language (never translate).
 * This module provides the writing rules for each supported language.
 *
 * IMPORTANT: When the requested language is "auto", we resolve to the
 * configured default. If the configured default is ALSO "auto" (the
 * schema default), we fall back to the env var DEFAULT_LANGUAGE, then
 * to "fa" because the bot's primary audience is Persian. Previous logic
 * returned "en" in this case, which caused all auto-published posts to
 * be in English even when the operator expected Persian.
 */

import type { LanguageConfig } from "../core/config/sections/language";

export interface LanguageInjectorDeps {
  readonly config: () => Promise<LanguageConfig>;
  /** Env-provided default language, used as tiebreaker when config is "auto". */
  readonly envDefaultLanguage?: () => string;
}

export class LanguageInjector {
  constructor(private readonly deps: LanguageInjectorDeps) {}

  /** Get the language rules string for the requested language. */
  async getRules(requestedLanguage: string): Promise<string> {
    const actual = await this.resolve(requestedLanguage);

    if (actual === "fa") return PERSIAN_RULES;
    if (actual === "en") return ENGLISH_RULES;
    return ENGLISH_RULES; // fallback
  }

  /**
   * Resolve a possibly-"auto" language to a concrete "en" | "fa".
   *
   * Resolution order:
   *   1. If `requestedLanguage` is concrete (not "auto") → use it.
   *   2. Else if `config.default` is concrete → use it.
   *   3. Else if env `DEFAULT_LANGUAGE` is "fa" → use "fa".
   *   4. Else default to "fa" (Fredy's primary audience is Persian).
   */
  async resolve(requestedLanguage: string): Promise<"en" | "fa"> {
    // Step 1: concrete request wins.
    if (requestedLanguage === "fa") return "fa";
    if (requestedLanguage === "en") return "en";

    // Step 2: config default.
    const config = await this.deps.config();
    if (config.default === "fa") return "fa";
    if (config.default === "en") return "en";

    // Step 3: env tiebreaker.
    const envLang = this.deps.envDefaultLanguage?.();
    if (envLang === "fa") return "fa";
    if (envLang === "en") return "en";

    // Step 4: final fallback — Persian (Fredy's primary audience).
    return "fa";
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
