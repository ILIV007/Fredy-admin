/**
 * src/plugins/sources/huggingface-blog/manifest.ts
 * Hugging Face Blog RSS plugin — Tier A.
 * Fetches the latest posts from the Hugging Face blog.
 * https://huggingface.co/blog/feed.xml
 */
import type { PluginManifest } from "../../../types/plugin";

export const huggingfaceBlogManifest: PluginManifest = {
  id: "huggingface-blog",
  name: "Hugging Face Blog",
  version: "1.0.0",
  enabled: true,
  category: "A",
  tier: "A",
  priority: 2,
  rateLimit: 0,
  supportsImages: false,
  description: "Latest posts from the Hugging Face blog (LLM, Inference, Transformers, Agents).",
  author: "Fredy",
  docsUrl: "https://huggingface.co/blog/feed.xml",
  homepage: "https://huggingface.co/blog",
  supportsMarkdown: true,
  supportsLanguage: ["en"],
};
