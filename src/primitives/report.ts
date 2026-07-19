/**
 * src/primitives/report.ts
 * v9.3.0: Centralized helpers for admin PM report formatting.
 *
 * Before this file, the same quality-emoji logic and report banner
 * pattern was duplicated 7+ times across scheduler-service.ts,
 * entry/manager.ts, and admin/screens/manual.ts. This file is the
 * single source of truth for those patterns.
 *
 * Pure functions — no I/O, no side effects, safe to call from anywhere.
 */

import { escapeHtml } from "./strings";

/** Quality score → colored emoji circle.
 *  - ≥80: 🟢 (green)
 *  - 60-79: 🟡 (yellow)
 *  - <60: 🔴 (red)
 *
 * Used in 7 places: scheduler-service.ts notifyAdminPm,
 * entry/manager.ts (queue send-now, post/channel success, post/channel
 * reject×2, post/channel summary), admin/screens/manual.ts (category
 * and source paths). */
export function qualityEmoji(score: number): string {
  if (score >= 80) return "🟢";
  if (score >= 60) return "🟡";
  return "🔴";
}

/** Build a box-drawing banner line: `━━━ 📤 TITLE ━━━`.
 *  This is the standard cover for ALL admin PM reports — manual publish
 *  (bot + Manager UI), scheduled auto-publish, queue send-now, failure
 *  notices, backup notices, KV quota alerts, stale-tick alerts, etc.
 *
 *  The `━━━` box-drawing characters give a visual cover around the
 *  report topic so the admin can immediately see what kind of report
 *  it is at a glance. */
export function reportBanner(emoji: string, title: string): string {
  return `<b>━━━ ${emoji} ${title} ━━━</b>`;
}

/** Build a `<blockquote>` row for a key/value pair in an admin PM report.
 *  Example: `reportRow("🔌", "Source Plugin", "github")` →
 *  `<blockquote>🔌 <b>Source Plugin:</b> github</blockquote>` */
export function reportRow(emoji: string, label: string, value: string | number | null | undefined): string {
  const safeValue = value === null || value === undefined ? "(none)" : escapeHtml(String(value));
  return `<blockquote>${emoji} <b>${escapeHtml(label)}:</b> ${safeValue}</blockquote>`;
}

/** Build a quality-score row with the colored emoji.
 *  Example: `qualityRow(85)` →
 *  `<blockquote>🟢 <b>Quality Score:</b> 85/100</blockquote>` */
export function qualityRow(score: number): string {
  return `<blockquote>${qualityEmoji(score)} <b>Quality Score:</b> ${score}/100</blockquote>`;
}
