/**
 * src/plugins/sources/index.ts
 * Barrel export for all content source plugins.
 *
 * TO ADD A NEW PLUGIN:
 *   1. Create src/plugins/sources/my-plugin/manifest.ts
 *   2. Create src/plugins/sources/my-plugin/index.ts (implementing Plugin)
 *   3. Add an import + export here
 *   4. Add a factory entry in the loader (src/services/plugin-loader.ts)
 *
 * That's it. No core code changes needed.
 * See ARCHITECTURE_RULES.md §5 (Plugin First).
 */

// Category A — Developer Content
export { GitHubPlugin, createGitHubPlugin, githubManifest } from "./github";
export { DevToPlugin, createDevToPlugin, devtoManifest } from "./devto";
export { StackExchangePlugin, createStackExchangePlugin, stackexchangeManifest } from "./stackexchange";
export { RedditPlugin, createRedditPlugin, redditManifest } from "./reddit";
export { GitHubReleasesPlugin, createGitHubReleasesPlugin, githubReleasesManifest } from "./github-releases";

// Category B — Tech News
export { NewsPlugin, createNewsPlugin, newsManifest } from "./news";
export { HackerNewsPlugin, createHackerNewsPlugin, hackernewsManifest } from "./hackernews";

// Category C — Support Content
export { NasaPlugin, createNasaPlugin, nasaManifest } from "./nasa";
export { JokePlugin, createJokePlugin, jokeManifest } from "./joke";
export { XkcdPlugin, createXkcdPlugin, xkcdManifest } from "./xkcd";
export { GitHubTrendingPlugin, createGitHubTrendingPlugin, githubTrendingManifest } from "./github-trending";
export { WikimediaPlugin, createWikimediaPlugin, wikimediaManifest } from "./wikimedia";

// ─── v11: New Tier-Based Providers ───

// Tier S — Core providers (refresh every 2h)
export { GitHubEventsPlugin, createGitHubEventsPlugin, githubEventsManifest } from "./github-events";
export { HackerNewsAlgoliaPlugin, createHackerNewsAlgoliaPlugin, hackernewsAlgoliaManifest } from "./hackernews-algolia";

// Tier A — Important providers (refresh every 6h)
export { CloudflareBlogPlugin, createCloudflareBlogPlugin, cloudflareBlogManifest } from "./cloudflare-blog";
export { HuggingFaceBlogPlugin, createHuggingFaceBlogPlugin, huggingfaceBlogManifest } from "./huggingface-blog";
export { ProductHuntPlugin, createProductHuntPlugin, producthuntManifest } from "./producthunt";

// Tier B — Supporting providers (refresh every 12h)
export { GitHubSecurityPlugin, createGitHubSecurityPlugin, githubSecurityManifest } from "./github-security";
export { OpenAINewsPlugin, createOpenAINewsPlugin, openaiNewsManifest } from "./openai-news";
export { RedditV2Plugin, createRedditV2Plugin, redditV2Manifest } from "./reddit-v2";

// Re-export the Plugin interface for convenience.
export type { Plugin, PluginManifest, PluginStatus, ProviderQualityResult } from "../../types/plugin";
