/**
 * src/services/prompt-builder.ts
 * Assembles the system + user prompts for an AI generation request.
 *
 * Order: system prompt (base + category + profile + soul + language) + user prompt (source item).
 * See src/core/ai/prompt-templates.ts for the templates.
 */

import { buildSystemPrompt, buildUserPrompt } from "../core/ai/prompt-templates";
import type { PromptProfile } from "../core/ai/prompt-templates";
import type { Soul } from "../types/ai";
import type { Category } from "../types/category";
import type { SourceItem } from "../types/api";
import type { LanguageInjector } from "./language-injector";

export interface PromptBuilderDeps {
  readonly languageInjector: LanguageInjector;
}

export interface BuiltPrompt {
  readonly system: string;
  readonly user: string;
  readonly resolvedLanguage: string;
}

export class PromptBuilder {
  constructor(private readonly deps: PromptBuilderDeps) {}

  /** Build the system + user prompts for a generation request. */
  async build(
    category: Category,
    sourceItem: SourceItem,
    requestedLanguage: string,
    soul: Soul,
    profile: PromptProfile = "default",
  ): Promise<BuiltPrompt> {
    const languageRules = await this.deps.languageInjector.getRules(requestedLanguage);
    const resolvedLanguage = await this.deps.languageInjector.resolve(requestedLanguage);

    const system = buildSystemPrompt(
      category,
      profile,
      soul.raw,
      languageRules,
    );

    const user = buildUserPrompt(sourceItem, resolvedLanguage);

    return { system, user, resolvedLanguage };
  }
}
