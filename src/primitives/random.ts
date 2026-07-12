/**
 * src/primitives/random.ts
 * Random utilities. Pure functions using crypto.getRandomValues.
 */

/** Random integer in [min, max] inclusive. */
export function randomInt(min: number, max: number): number {
  if (max < min) throw new Error(`randomInt: max (${max}) < min (${min})`);
  const range = max - min + 1;
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  return min + (Math.abs(value) % range);
}

/** Pick a random element from a non-empty array. Throws on empty. */
export function pickRandom<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error("pickRandom: empty array");
  return items[randomInt(0, items.length - 1)]!;
}

/** Shuffle a copy of an array (Fisher-Yates). Returns a new array. */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Pick an element from a weighted list. Weights are relative, not normalized. */
export function pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
  if (items.length === 0) throw new Error("pickWeighted: empty array");
  if (items.length !== weights.length) {
    throw new Error(`pickWeighted: length mismatch (${items.length} vs ${weights.length})`);
  }
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return pickRandom(items);
  let target = randomInt(0, Math.floor(total * 1000)) / 1000;
  for (let i = 0; i < items.length; i++) {
    target -= Math.max(0, weights[i]!);
    if (target <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}
