/**
 * src/admin/helpers/formatting.ts
 * Text formatting helpers for admin panel messages.
 *
 * Centralizes status badges, toggle labels, and section dividers so
 * that all admin screens use consistent formatting.
 */

import { escapeHtml } from "../../primitives/strings";
export { escapeHtml };

/** Format a boolean as a status badge. */
export function statusBadge(isOn: boolean): string {
  return isOn ? "🟢 ON" : "🔴 OFF";
}

/** Format a boolean as yes/no. */
export function yesNo(value: boolean): string {
  return value ? "✅ Yes" : "❌ No";
}

/** Format a number with thousands separators. */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format an epoch ms as ISO string. */
export function formatTime(epochMs: number | null): string {
  if (!epochMs) return "never";
  return new Date(epochMs).toISOString();
}

/** Format an epoch ms as a relative time (e.g., "2h ago"). */
export function formatRelativeTime(epochMs: number | null, now = Date.now()): string {
  if (!epochMs) return "never";
  const diff = now - epochMs;
  if (diff < 60_000) return "just now";
  if (diff < MS_PER_HOUR) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)}h ago`;
  return `${Math.floor(diff / MS_PER_DAY)}d ago`;
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Build a header line with a divider. */
export function header(title: string, emoji = ""): string {
  return `${emoji ? emoji + " " : ""}<b>${escapeHtml(title)}</b>`;
}

/** Build a section divider. */
export function divider(): string {
  return "────────────────";
}

/** Build a key-value line. */
export function kv(key: string, value: string | number | boolean | null | undefined): string {
  const displayValue =
    typeof value === "boolean" ? statusBadge(value) :
    value === null || value === undefined ? "<i>(none)</i>" :
    String(value);
  return `<b>${escapeHtml(key)}:</b> ${displayValue}`;
}

/** Escape HTML — re-exported from primitives/strings.ts (single source of truth). */
// (escapeHtml is imported and re-exported at the top of this file)

/** Truncate a string for display. */
export function truncate(input: string | null | undefined, maxLen: number, suffix = "…"): string {
  if (input === null || input === undefined) return "";
  if (input.length <= maxLen) return input;
  return input.slice(0, maxLen - suffix.length) + suffix;
}

/** Format a list of items as bullet points. */
export function bulletList(items: readonly string[]): string {
  return items.map((item) => `  • ${item}`).join("\n");
}

/** Format a code block. */
export function codeBlock(content: string): string {
  return `<code>${escapeHtml(content)}</code>`;
}
