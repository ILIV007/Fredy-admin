/**
 * src/core/config/sections/content.ts
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
  queueMinA: z.number().int().min(0).max(50).default(2),
  queueTargetA: z.number().int().min(0).max(50).default(4),
  queueMinB: z.number().int().min(0).max(50).default(1),
  queueTargetB: z.number().int().min(0).max(50).default(2),
  queueMinC: z.number().int().min(0).max(50).default(2),
  queueTargetC: z.number().int().min(0).max(50).default(4),
});

export type ContentConfig = z.infer<typeof contentSchema>;

export const contentDefaults: ContentConfig = {
  _version: 1,
  postsPerDay: 4,
  categoryDistribution: { A: 50, B: 25, C: 25 },
  randomOffsetMinutes: 25,
  burstPosting: false,
  duplicatePrevention: true,
  duplicateTtlHours: 24 * 7,
  sourceFooterFormat: "{emoji}Source",
  sourceEmojiPool: [
    "🌌", "🚀", "🤖", "📦", "⚡", "💡", "📚", "🛠️", "🌐", "🔒",
    "🎯", "🧩", "📝", "📊", "🔗", "🔧", "✨", "🐞", "📥", "🪐",
  ],
  emojiHistorySize: 10,
  queueMinA: 2, queueTargetA: 4,
  queueMinB: 1, queueTargetB: 2,
  queueMinC: 2, queueTargetC: 4,
};

export const contentSection = {
  key: "content",
  version: 1,
  schema: contentSchema,
  defaults: contentDefaults,
  description: "Posts per day, queue sizes, dedup, emoji pool.",
};
