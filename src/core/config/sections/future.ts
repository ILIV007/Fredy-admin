/**
 * src/core/config/sections/future.ts
 * Future extensions placeholder. Free-form key-value map for experimental
 * config sections that haven't been formalized yet.
 */

import { z } from "zod";

export const futureSchema = z.object({
  _version: z.literal(1),
  extensions: z.record(z.string(), z.unknown()),
});

export type FutureConfig = z.infer<typeof futureSchema>;

export const futureDefaults: FutureConfig = {
  _version: 1,
  extensions: {},
};

export const futureSection = {
  key: "future",
  version: 1,
  schema: futureSchema,
  defaults: futureDefaults,
  description:
    "Free-form key-value map for experimental config. Allows new sections to be tested before formalization.",
};
