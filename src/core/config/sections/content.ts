/**
 * src/core/config/sections/content.ts
 * Content publishing rules. See FREDY_GUIDELINES.md §2 (length limits) and §9 (dedup).
 */

import { z } from "zod";

export const contentSchema = z.object({
  _version: z.literal(1),
  postsPerDay: z.number().int().min(1).max(20),
  categoryDistribution: z.object({
    A: z.number().min(0).max(100),
    B: z.number().min(0).max(100),
    C: z.number().min(0).max(100),
  }),
  randomOffsetMinutes: z.number().int().min(0).max(120),
  burstPosting: z.boolean(),
  duplicatePrevention: z.boolean(),
  duplicateTtlHours: z.number().int().min(1).max(24 * 30),
  sourceFooterFormat: z.string().default("{emoji}Source"),
  sourceEmojiPool: z.array(z.string()).default([
    "🌌", "🚀", "🤖", "📦", "⚡", "💡", "📚", "🛠️", "🌐", "🔒",
    "🎯", "🧩", "📝", "📊", "🔗", "🔧", "✨", "🐞", "📥", "🪐",
  ]),
  emojiHistorySize: z.number().int().min(5).max(50).default(10),
});

export type ContentConfig = z.infer<typeof contentSchema>;

export const contentDefaults: ContentConfig = {
  _version: 1,
  postsPerDay: 4,
  categoryDistribution: { A: 50, B: 25, C: 25 },
  randomOffsetMinutes: 30,
  burstPosting: false,
  duplicatePrevention: true,
  duplicateTtlHours: 24 * 7,
  sourceFooterFormat: "{emoji}Source",
  sourceEmojiPool: [
    "🌌", "🚀", "🤖", "📦", "⚡", "💡", "📚", "🛠️", "🌐", "🔒",
    "🎯", "🧩", "📝", "📊", "🔗", "🔧", "✨", "🐞", "📥", "🪐",
  ],
  emojiHistorySize: 10,
};

export const contentSection = {
  key: "content",
  version: 1,
  schema: contentSchema,
  defaults: contentDefaults,
  description:
    "Posts per day, category distribution, random offset, burst posting, dedup TTL, and source emoji rotation.",
};
