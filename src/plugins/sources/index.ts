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

// Re-export the Plugin interface for convenience.
export type { Plugin, PluginManifest, PluginStatus } from "../../types/plugin";
