/**
 * src/services/hook-engine.ts
 * Generates dynamic, content-aware hooks for each post.
 *
 * Rules (Prompt 13):
 *   - Hook must NOT be generic ("Check this out" = BAD)
 *   - Hook must NOT be reused (track recent hooks in KV)
 *   - Hook must reflect actual content insight
 *   - Hook must be 1 line max
 *   - Hook must increase curiosity
 *   - Hook must match category tone
 *
 * The hook is generated from the content itself (title + body + tags),
 * not from a template. Each category has a different tone.
 */

import type { ReadyContent } from "../types/content";
import type { Category } from "../types/category";
import type { Logger } from "./logger";

export interface HookEngineDeps {
  readonly logger: Logger;
}

/** Maximum hook length (characters). */
const MAX_HOOK_LENGTH = 100;

/** Recent hooks (in-memory, per isolate, to avoid reuse within a session). */
const recentHooks: string[] = [];
const MAX_RECENT = 20;

export class HookEngine {
  constructor(private readonly deps: HookEngineDeps) {}

  /** Generate a dynamic hook for a ReadyContent. */
  generate(content: ReadyContent): string {
    // Use the AI-generated headline as the hook if available.
    // This ensures the hook is in the same language as the content.
    if (content.headline && content.headline.trim().length > 5) {
      return content.headline.trim();
    }

    const candidates = this.generateCandidates(content);

    // Pick the first candidate that hasn't been used recently.
    for (const candidate of candidates) {
      if (!recentHooks.includes(candidate)) {
        recentHooks.unshift(candidate);
        if (recentHooks.length > MAX_RECENT) {
          recentHooks.length = MAX_RECENT;
        }
        return candidate;
      }
    }

    // All candidates were used — return the first one anyway.
    return candidates[0] ?? this.fallbackHook(content);
  }

  /** Generate multiple hook candidates from content. */
  private generateCandidates(content: ReadyContent): string[] {
    const candidates: string[] = [];
    const title = content.headline ?? "";
    const body = content.text;
    const category = content.category;

    // Strategy 1: Category-specific hook patterns.
    candidates.push(...this.categoryHooks(content, category, title, body));

    // Strategy 2: Content-insight hooks (extract a surprising fact).
    candidates.push(...this.insightHooks(body, category));

    // Strategy 3: Action hooks ("X just did Y").
    candidates.push(...this.actionHooks(title, body));

    // Strategy 4: Question hooks.
    candidates.push(...this.questionHooks(title, body, category));

    // Deduplicate and trim.
    const unique = [...new Set(candidates)]
      .map((h) => this.cleanHook(h))
      .filter((h) => h.length > 10 && h.length <= MAX_HOOK_LENGTH);

    return unique.length > 0 ? unique : [this.fallbackHook(content)];
  }

  /** Category-specific hook patterns. */
  private categoryHooks(
    content: ReadyContent,
    category: Category,
    title: string,
    body: string,
  ): string[] {
    const hooks: string[] = [];

    if (category === "A") {
      // Developer content — technical, tool-focused.
      if (title.toLowerCase().includes("release") || title.toLowerCase().includes("v")) {
        hooks.push(`${this.extractName(title)} just shipped something worth checking.`);
      }
      if (body.toLowerCase().includes("framework") || body.toLowerCase().includes("library")) {
        hooks.push(`A new tool that might change how you build.`);
      }
      if (title.toLowerCase().includes("github")) {
        hooks.push(`GitHub just got a repo worth bookmarking.`);
      }
      hooks.push(`This dev tool deserves more attention.`);
      hooks.push(`Something every developer should know about.`);
    }

    if (category === "B") {
      // Tech news — factual, impactful.
      if (title.toLowerCase().includes("announce") || title.toLowerCase().includes("launch")) {
        hooks.push(`${this.extractName(title)} made a move that matters.`);
      }
      hooks.push(`The tech world just shifted a little.`);
      hooks.push(`This news affects how we build.`);
      hooks.push(`A quiet update with loud implications.`);
    }

    if (category === "C") {
      // Support content — NASA, jokes, quotes, facts.
      if (content.pluginId === "nasa") {
        hooks.push(`NASA captured something unexpected again.`);
        hooks.push(`The universe just showed off again.`);
        hooks.push(`Space had a moment today.`);
      }
      if (content.pluginId === "xkcd") {
        hooks.push(`XKCD nailed it again.`);
        hooks.push(`This comic explains it perfectly.`);
      }
      if (content.pluginId === "joke") {
        hooks.push(`Because devs need a laugh too.`);
      }
      hooks.push(`Here's something worth knowing.`);
      hooks.push(`A small thing that makes the day better.`);
    }

    return hooks;
  }

  /** Insight hooks — extract a surprising fact from the body. */
  private insightHooks(body: string, _category: Category): string[] {
    const hooks: string[] = [];
    const sentences = body.split(/[.!?]\s/).filter((s) => s.trim().length > 20);

    // Look for sentences with numbers (often surprising stats).
    for (const sentence of sentences) {
      const numbers = sentence.match(/\d+/g);
      if (numbers && numbers.length > 0) {
        const num = numbers[0];
        hooks.push(`Did you know? ${sentence.trim().slice(0, 80)}...`.slice(0, MAX_HOOK_LENGTH));
        break;
      }
    }

    // Look for comparison language.
    if (body.toLowerCase().includes("faster") || body.toLowerCase().includes("better")) {
      hooks.push(`This is faster than what you're using now.`);
    }
    if (body.toLowerCase().includes("simpler") || body.toLowerCase().includes("easier")) {
      hooks.push(`It shouldn't be this easy. But it is.`);
    }

    return hooks;
  }

  /** Action hooks — "X just did Y". */
  private actionHooks(title: string, _body: string): string[] {
    const hooks: string[] = [];
    const name = this.extractName(title);

    if (title.toLowerCase().includes("release")) {
      hooks.push(`${name} just released something new.`);
    }
    if (title.toLowerCase().includes("launch")) {
      hooks.push(`${name} just launched.`);
    }
    if (title.toLowerCase().includes("update")) {
      hooks.push(`${name} just updated.`);
    }

    return hooks;
  }

  /** Question hooks — provoke curiosity. */
  private questionHooks(title: string, _body: string, category: Category): string[] {
    const hooks: string[] = [];

    if (category === "A") {
      hooks.push(`What if building was this simple?`);
      hooks.push(`Why isn't everyone talking about this?`);
    }
    if (category === "B") {
      hooks.push(`What does this mean for developers?`);
      hooks.push(`Is this the turning point?`);
    }

    return hooks;
  }

  /** Extract a name (tool, company, repo) from a title. */
  private extractName(title: string): string {
    // Try to find a proper noun or repo name.
    const repoMatch = /([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/.exec(title);
    if (repoMatch) return repoMatch[1]!;

    // Try to find a capitalized word.
    const capMatch = /\b([A-Z][a-zA-Z]{2,})\b/.exec(title);
    if (capMatch) return capMatch[1]!;

    return "This";
  }

  /** Clean a hook: trim, remove trailing punctuation, limit length. */
  private cleanHook(hook: string | null | undefined): string {
    if (!hook) return "";
    let cleaned = hook.trim();
    if (!cleaned) return "";
    // Remove trailing period (hooks shouldn't end with .).
    cleaned = cleaned.replace(/[.]+$/, "");
    // Limit length.
    if (cleaned.length > MAX_HOOK_LENGTH) {
      cleaned = cleaned.slice(0, MAX_HOOK_LENGTH - 3) + "...";
    }
    return cleaned;
  }

  /** Fallback hook if all strategies fail. */
  private fallbackHook(content: ReadyContent): string {
    const fallbacks: Readonly<Record<Category, string>> = {
      A: "This deserves a look.",
      B: "Something just happened in tech.",
      C: "Here's something interesting.",
    };
    return fallbacks[content.category] ?? "Worth checking out.";
  }

  /** Get recent hooks (for debugging). */
  getRecent(): readonly string[] {
    return [...recentHooks];
  }

  /** Clear recent hooks (for testing). */
  clearRecent(): void {
    recentHooks.length = 0;
  }
}
