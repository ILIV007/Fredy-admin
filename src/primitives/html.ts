/**
 * src/primitives/html.ts
 * HTML utilities for Telegram HTML formatting.
 *
 * Ported from AI Admin v0.6.9 src/html-utils.js with TypeScript strict types.
 *
 * closeOpenTags: stack-based tag closing after truncation.
 * truncateHtml: smart truncation at paragraph/sentence/newline boundaries.
 */

/** Self-closing / void elements that never appear on the open-stack. */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * Close any unclosed HTML tags at the end of a (possibly truncated) string.
 * Uses a stack-based approach: scan for tags, push openings, pop closings,
 * append remaining closings in reverse order.
 */
export function closeOpenTags(html: string): string {
  if (!html || typeof html !== "string") return html ?? "";

  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?\/?>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = TAG_RE.exec(html)) !== null) {
    const isClosing = match[1] === "/";
    const tagName = (match[2] ?? "").toLowerCase();

    if (isClosing) {
      const idx = stack.lastIndexOf(tagName);
      if (idx !== -1) {
        stack.splice(idx);
      }
    } else {
      if (!VOID_TAGS.has(tagName)) {
        const fullTag = match[0] ?? "";
        if (!fullTag.endsWith("/>")) {
          stack.push(tagName);
        }
      }
    }
  }

  if (stack.length === 0) return html;

  const closingTags = stack
    .slice()
    .reverse()
    .map((tag) => `</${tag}>`)
    .join("");

  return html + closingTags;
}

/**
 * Truncate an HTML string at a safe boundary and close any open tags.
 *
 * Tries (in order):
 *   1. Paragraph boundary (\n\n) within 500 chars of target
 *   2. Sentence boundary (. ! ? ۔) within 300 chars
 *   3. Newline within 200 chars
 *   4. Avoid cutting inside an HTML tag (between < and >)
 *   5. Close all unclosed tags via closeOpenTags()
 */
export function truncateHtml(html: string, maxLen: number, suffix = ""): string {
  if (!html || html.length <= maxLen) return html ?? "";
  if (maxLen < 50) return html.slice(0, maxLen);

  const suffixLen = suffix.length;
  const targetLen = maxLen - suffixLen;
  let cutPoint = targetLen;

  // 1. Try paragraph boundary.
  const lastPara = html.lastIndexOf("\n\n", cutPoint);
  if (lastPara > cutPoint - 500 && lastPara > 100) {
    cutPoint = lastPara;
  } else {
    // 2. Try sentence boundary (English + Persian).
    const lastSentence = Math.max(
      html.lastIndexOf(". ", cutPoint),
      html.lastIndexOf("! ", cutPoint),
      html.lastIndexOf("? ", cutPoint),
      html.lastIndexOf("۔ ", cutPoint),
      html.lastIndexOf("۔\n", cutPoint),
    );
    if (lastSentence > cutPoint - 300 && lastSentence > 100) {
      cutPoint = lastSentence + 1;
    } else {
      // 3. Try newline.
      const lastNL = html.lastIndexOf("\n", cutPoint);
      if (lastNL > cutPoint - 200 && lastNL > 100) {
        cutPoint = lastNL;
      }
    }
  }

  // 4. Avoid cutting inside an HTML tag.
  const lastGT = html.lastIndexOf(">", cutPoint);
  const lastLT = html.lastIndexOf("<", cutPoint);
  if (lastLT > lastGT) {
    cutPoint = lastLT - 1;
  }

  if (cutPoint < 50) cutPoint = targetLen;

  const truncated = html.slice(0, cutPoint) + suffix;
  return closeOpenTags(truncated);
}

/** Wrap a URL in a blockquote (Fredy's standard link display). */
export function wrapUrlInBlockquote(url: string): string {
  return `<blockquote>${url}</blockquote>`;
}

/** Wrap a URL in a collapsible blockquote (for long URLs). */
export function wrapUrlInExpandable(url: string): string {
  return `<blockquote expandable="true">${url}</blockquote>`;
}

/** Check if HTML has balanced tags (rough check). */
export function hasBalancedTags(html: string): boolean {
  if (!html || html.length === 0) return true;
  const closed = closeOpenTags(html);
  return closed === html;
}

/** Escape HTML special characters. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Strip all HTML tags from a string. */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

/**
 * Validate and fix common HTML issues that cause Telegram parse errors.
 * Ported from AI Admin formatter.js validateAndFixHtml().
 */
export function validateAndFixHtml(html: string): string {
  let r = html;

  // Close unclosed tags.
  const tags = ["blockquote", "a", "b", "i", "code", "pre", "s", "u"];
  for (const tag of tags) {
    const openRegex = tag === "a" ? /<a\s/g : new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g");
    const open = (r.match(openRegex) || []).length;
    const close = (r.match(new RegExp(`</${tag}>`, "g")) || []).length;
    if (open > close) r += `</${tag}>`.repeat(open - close);
  }

  // Remove nested blockquotes (but not expandable ones).
  r = r.replace(/<blockquote>([^<]*?)<blockquote>/g, "$1");
  r = r.replace(/<\/blockquote>([^<]*?)<\/blockquote>/g, "$1</blockquote>");

  // Remove empty tags.
  r = r.replace(/<b>\s*<\/b>/g, "");
  r = r.replace(/<i>\s*<\/i>/g, "");
  r = r.replace(/<code>\s*<\/code>/g, "");

  return r;
}

/** Shorten a URL for display (hostname + pathname, truncated). */
export function shortenUrl(url: string, maxLen = 40): string {
  try {
    const u = new URL(url);
    let label = u.hostname + u.pathname;
    label = label.replace(/\/$/, "");
    if (label.length > maxLen) label = label.slice(0, maxLen - 1) + "…";
    return label;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen - 1) + "…" : url;
  }
}

/** Trim trailing punctuation from a URL. */
export function trimUrlPunctuation(url: string): string {
  return url.replace(/[.,);:!?}\]]+$/, "");
}
