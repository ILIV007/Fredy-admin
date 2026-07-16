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

/** Escape HTML special characters. Handles null/undefined (returns "").
 *  This is the single source of truth for HTML escaping in the project.
 *  Used by: ux-layer.ts, admin/helpers/formatting.ts, orchestrators/admin.ts. */
export function escapeHtml(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
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

/** Insert half-space (ZWNJ) after common Persian prefixes and before
 *  common suffixes. Also fixes common mistakes like "می شود" → "می‌شود".
 *  Called by ux-layer.ts when content.language === "fa". */
export function fixPersianHalfSpaces(input: string): string {
  if (!input) return input;
  const ZWNJ = "\u200c"; // Zero-Width Non-Joiner
  let result = input;
  // Common prefixes that need ZWNJ
  const prefixes = ["می", "نمی", "بی", "می‌"];
  for (const p of prefixes) {
    result = result.replace(new RegExp(p + " ", "gi"), p + ZWNJ);
  }
  // Common suffixes that need ZWNJ
  const suffixes = ["ها", "های", "تر", "ترین", "گر", "گری", "شناس", "شناسی", "سازی", "گذار", "گذاری"];
  for (const s of suffixes) {
    result = result.replace(new RegExp(" " + s + "(?=[ \n.،؟!؛]|$)", "gi"), ZWNJ + s);
  }
  // Fix "می شود" -> "می‌شود" (common mistake)
  result = result.replace(/می\s+شود/gi, "می" + ZWNJ + "شود");
  result = result.replace(/نمی\s+شد/gi, "نمی" + ZWNJ + "شد");
  return result;
}

/** Insert RTL mark (U+200F) at the start of mixed-direction text. */
export function ensureRtlMark(input: string): string {
  if (input.length === 0) return input;
  return "\u200F" + input;
}
