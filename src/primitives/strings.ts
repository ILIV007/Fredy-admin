/**
 * src/primitives/strings.ts
 * Pure string utilities. No I/O, no side effects, no globals.
 */

/** Collapse all runs of whitespace into a single space. */
export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** Truncate a string to maxLen, appending an ellipsis if cut. */
export function truncate(input: string, maxLen: number, suffix = "…"): string {
  if (input.length <= maxLen) return input;
  return input.slice(0, Math.max(0, maxLen - suffix.length)) + suffix;
}

/** Escape HTML special characters. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip all HTML tags from a string. */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

/** Strip all emojis from a string (best-effort). */
export function stripEmojis(input: string): string {
  // Match common emoji ranges. Not exhaustive — for dedup normalization only.
  return input.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu,
    "",
  );
}

/** Normalize a string for dedup hashing: lowercase, collapse whitespace, strip HTML and emojis. */
export function normalizeForDedup(input: string): string {
  return collapseWhitespace(stripEmojis(stripHtml(input)).toLowerCase());
}

/** Check if a string is "mostly" uppercase (used for ALL-CAPS spam detection). */
export function isMostlyUppercase(input: string, threshold = 0.7): boolean {
  const letters = input.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 10) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= threshold;
}

/** Insert half-space (ZWNJ) after common Persian prefixes. Stub — real impl in Phase 1.4. */
export function fixPersianHalfSpaces(input: string): string {
  // TODO: implement in Phase 1.4 (Persian language rules).
  return input;
}

/** Insert RTL mark (U+200F) at the start of mixed-direction text. */
export function ensureRtlMark(input: string): string {
  if (input.length === 0) return input;
  return "\u200F" + input;
}
