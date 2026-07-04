/**
 * src/services/language-manager.ts
 * Resolves "auto" to a concrete language. Per-language formatting rules
 * live in soul.md, not here.
 */

import type { SourceItem } from "../types/api";

export interface LanguageManagerDeps {
  readonly defaultLanguage: "en" | "fa";
}

export class LanguageManager {
  constructor(private readonly deps: LanguageManagerDeps) {}

  /** Resolve "auto" to a concrete language based on the source item. */
  resolve(
    setting: "auto" | "en" | "fa",
    sourceItem: SourceItem,
  ): "en" | "fa" {
    if (setting !== "auto") return setting;
    // TODO: implement detection in Phase 2 (AI layer).
    // For the scaffold, default to the configured default language.
    void sourceItem;
    return this.deps.defaultLanguage;
  }

  /** Detect if a string is mostly Persian/Arabic script. */
  isRtl(text: string): boolean {
    const rtlChars = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g);
    const latinChars = text.match(/[a-zA-Z]/g);
    const rtlCount = rtlChars?.length ?? 0;
    const latinCount = latinChars?.length ?? 0;
    return rtlCount > latinCount;
  }
}
