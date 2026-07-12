/**
 * src/services/tagging-system.ts
 * Automatically assigns tags to StandardPost based on content analysis.
 *
 * Tags are derived from:
 *   - Content keywords (title + body)
 *   - Provider source (github → "github", "open-source")
 *   - Category mapping (A → "programming", B → "news", C → "nasa")
 *   - URL patterns (github.com → "github", xkcd.com → "xkcd")
 *
 * See Prompt 11 spec.
 */

import type { StandardPost } from "../types/content";
import type { Category } from "../types/category";
import type { Logger } from "./logger";

export interface TaggingSystemDeps {
  readonly logger: Logger;
}

/** Tag definitions: tag → keywords that trigger it. */
const TAG_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  "ai": ["ai", "artificial intelligence", "machine learning", "ml", "neural", "llm", "gpt", "model", "deep learning", "transformer"],
  "programming": ["programming", "coding", "code", "developer", "software", "algorithm", "function", "variable", "class", "method"],
  "open-source": ["open source", "opensource", "oss", "github", "mit license", "apache", "gpl", "fork", "contribute"],
  "dev-tools": ["tool", "cli", "terminal", "ide", "editor", "debugger", "linter", "formatter", "build", "deploy"],
  "news": ["news", "announces", "released", "launches", "breaking", "update", "acquisition", "funding"],
  "tutorial": ["tutorial", "guide", "how to", "step by step", "walkthrough", "example", "learn"],
  "github": ["github", "repo", "repository", "commit", "pull request", "pr", "issue"],
  "nasa": ["nasa", "space", "astronomy", "galaxy", "planet", "star", "telescope", "apod"],
  "javascript": ["javascript", "js", "node", "npm", "deno", "bun", "ecmascript"],
  "typescript": ["typescript", "ts", "tsc", "tsx"],
  "python": ["python", "pip", "django", "flask", "pandas", "numpy"],
  "rust": ["rust", "cargo", "crates", "rustc"],
  "golang": ["golang", "go ", "goroutine", "channel"],
  "react": ["react", "jsx", "hooks", "component", "next.js", "nextjs"],
  "vue": ["vue", "vuejs", "vuex", "pinia"],
  "angular": ["angular", "ngrx", "rxjs"],
  "framework": ["framework", "library", "sdk", "package"],
  "security": ["security", "vulnerability", "cve", "exploit", "patch", "encryption"],
  "cloud": ["cloud", "aws", "azure", "gcp", "serverless", "lambda", "worker"],
  "database": ["database", "sql", "postgres", "mysql", "mongodb", "redis", "sqlite"],
  "api": ["api", "rest", "graphql", "endpoint", "webhook", "grpc"],
  "devops": ["devops", "ci/cd", "docker", "kubernetes", "k8s", "pipeline", "jenkins"],
  "web": ["web", "html", "css", "browser", "frontend", "backend"],
  "mobile": ["mobile", "ios", "android", "react native", "flutter", "swift", "kotlin"],
  "game": ["game", "gamedev", "unity", "unreal", "godot"],
  "xkcd": ["xkcd", "comic"],
  "joke": ["joke", "humor", "funny"],
  "quote": ["quote", "quotation"],
  "history": ["history", "today in history", "on this day", "historical"],
  "hardware": ["hardware", "cpu", "gpu", "ram", "ssd", "chip", "silicon"],
};

/** Category-based default tags. */
const CATEGORY_TAGS: Readonly<Record<Category, readonly string[]>> = {
  A: ["programming", "developer"],
  B: ["news", "tech"],
  C: ["support"],
};

/** Source-based tags. */
const SOURCE_TAGS: Readonly<Record<string, readonly string[]>> = {
  github: ["github", "open-source"],
  "github-trending": ["github", "open-source", "trending"],
  "github-releases": ["github", "release"],
  news: ["news"],
  hackernews: ["news", "hackernews"],
  devto: ["devto", "community"],
  stackexchange: ["stackoverflow", "q&a"],
  reddit: ["reddit", "community"],
  nasa: ["nasa", "space"],
  joke: ["joke", "humor"],
  xkcd: ["xkcd", "comic"],
  wikimedia: ["history", "wikipedia"],
};

/** Maximum tags per post. */
const MAX_TAGS = 8;

export class TaggingSystem {
  constructor(private readonly deps: TaggingSystemDeps) {}

  /** Assign tags to a StandardPost. Returns a new post with tags. */
  assignTags(post: StandardPost): StandardPost {
    const tags = this.generateTags(post);
    return { ...post, tags };
  }

  /** Generate tags for a post. */
  private generateTags(post: StandardPost): readonly string[] {
    const tagSet = new Set<string>();

    // 1. Category-based tags.
    for (const tag of CATEGORY_TAGS[post.category] ?? []) {
      tagSet.add(tag);
    }

    // 2. Source-based tags.
    for (const tag of SOURCE_TAGS[post.source] ?? []) {
      tagSet.add(tag);
    }

    // 3. Keyword-based tags (scan title + body).
    const text = `${post.title} ${post.body}`.toLowerCase();
    for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
      if (tagSet.size >= MAX_TAGS) break;
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          tagSet.add(tag);
          break;
        }
      }
    }

    // 4. URL-based tags.
    const urlTags = this.extractUrlTags(post.url);
    for (const tag of urlTags) {
      if (tagSet.size >= MAX_TAGS) break;
      tagSet.add(tag);
    }

    // 5. Provider enrichment tags (if topics exist).
    if (post.provider.topics) {
      for (const topic of post.provider.topics) {
        if (tagSet.size >= MAX_TAGS) break;
        tagSet.add(topic.toLowerCase());
      }
    }

    // Convert to array, sort alphabetically, cap at MAX_TAGS.
    return Array.from(tagSet).sort().slice(0, MAX_TAGS);
  }

  /** Extract tags from URL patterns. */
  private extractUrlTags(url: string): string[] {
    const tags: string[] = [];
    const lower = url.toLowerCase();

    if (lower.includes("github.com")) tags.push("github");
    if (lower.includes("news.ycombinator.com")) tags.push("hackernews");
    if (lower.includes("dev.to")) tags.push("devto");
    if (lower.includes("stackoverflow.com")) tags.push("stackoverflow");
    if (lower.includes("reddit.com")) tags.push("reddit");
    if (lower.includes("apod.nasa.gov") || lower.includes("nasa.gov")) tags.push("nasa");
    if (lower.includes("xkcd.com")) tags.push("xkcd");
    if (lower.includes("wikipedia.org")) tags.push("wikipedia");

    return tags;
  }

  /** Get all available tag definitions (for the admin panel). */
  getAvailableTags(): readonly string[] {
    return Object.keys(TAG_KEYWORDS).sort();
  }

  /** Check if a post has a specific tag. */
  hasTag(post: StandardPost, tag: string): boolean {
    return post.tags.includes(tag);
  }
}

/** Re-export for testing. */
export { TAG_KEYWORDS, CATEGORY_TAGS, SOURCE_TAGS, MAX_TAGS };
