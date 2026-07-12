/**
 * src/core/config/sections/categories.ts
 */
import { z } from "zod";

export const categoryItemSchema = z.object({
  enabled: z.boolean(),
  dailyLimit: z.number().int().min(0).max(50),
  priority: z.number().int().min(1).max(10),
  weight: z.number().min(0).max(100),
  fallback: z.enum(["skip", "next", "retry"]).default("skip"),
});

export const categoriesSchema = z.object({
  _version: z.literal(1),
  A: categoryItemSchema,
  B: categoryItemSchema,
  C: categoryItemSchema,
  rotationOrder: z.array(z.enum(["A", "B", "C"])).default(["A", "B", "A", "C", "A", "C", "B", "A", "C"]),
  allowSameCategoryTwice: z.boolean().default(false),
});

export type CategoryItemConfig = z.infer<typeof categoryItemSchema>;
export type CategoriesConfig = z.infer<typeof categoriesSchema>;

export const categoriesDefaults: CategoriesConfig = {
  _version: 1,
  A: { enabled: true, dailyLimit: 4, priority: 1, weight: 45, fallback: "skip" },
  B: { enabled: true, dailyLimit: 2, priority: 2, weight: 25, fallback: "skip" },
  C: { enabled: true, dailyLimit: 3, priority: 3, weight: 30, fallback: "skip" },
  rotationOrder: ["A", "B", "A", "C", "A", "C", "B", "A", "C"],
  allowSameCategoryTwice: false,
};

export const categoriesSection = {
  key: "categories",
  version: 1,
  schema: categoriesSchema,
  defaults: categoriesDefaults,
  description: "Per-category enable, daily limit, priority, weight, fallback, rotation.",
};
