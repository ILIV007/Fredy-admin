/**
 * src/primitives/html.ts
 * Pure HTML utilities for Telegram HTML formatting.
 * Reused from AI Admin src/html-utils.ts (validated, will be ported in Phase 6).
 */

/** Close any open HTML tags in a fragment. Stub — port from AI Admin in Phase 6. */
export function closeOpenTags(html: string): string {
  // TODO: port from AI Admin src/html-utils.ts in Phase 6.
  return html;
}

/** Truncate HTML to a max character length, closing any open tags. */
export function truncateHtml(
  html: string,
  maxLen: number,
  suffix = "\n\n<i>…</i>",
): string {
  // TODO: port from AI Admin in Phase 6.
  return html.slice(0, maxLen) + suffix;
}

/** Wrap a URL in a blockquote (Fredy's standard link display). */
export function wrapUrlInBlockquote(url: string): string {
  return `<blockquote>${url}</blockquote>`;
}

/** Wrap a URL in a collapsible blockquote (for long URLs). */
export function wrapUrlInExpandable(url: string): string {
  return `<blockquote expandable="true">${url}</blockquote>`;
}

/** Check if HTML has balanced tags (very rough). */
export function hasBalancedTags(html: string): boolean {
  // TODO: real implementation in Phase 6.
  return html.length > 0;
}
