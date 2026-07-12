/**
 * src/admin/keyboards/buttons.ts
 * Reusable inline keyboard button builders.
 *
 * Every screen uses these helpers instead of building buttons inline.
 * This keeps the visual grammar consistent across the admin panel
 * and makes changes (e.g., adding icons) a one-file edit.
 *
 * See ARCHITECTURE_RULES.md §12 (Admin Panel registry-based).
 */

import type { InlineKeyboard, InlineKeyboardButton } from "../../types/telegram";

// ────────────────────────────────────────────────────────────
// Single-button builders
// ────────────────────────────────────────────────────────────

/** A standard navigation button. */
export function navButton(text: string, target: string): InlineKeyboardButton {
  return { text, callback_data: target };
}

/** A "back to main menu" button. */
export function backButton(target = "menu:main"): InlineKeyboardButton {
  return { text: "← Back", callback_data: target };
}

/** A "cancel" button. */
export function cancelButton(target = "menu:main"): InlineKeyboardButton {
  return { text: "✖ Cancel", callback_data: target };
}

/** A confirmation button (e.g., for destructive actions). */
export function confirmButton(text: string, callbackData: string): InlineKeyboardButton {
  return { text, callback_data: callbackData };
}

/** A no-op button (used for labels in steppers). */
export function labelButton(text: string): InlineKeyboardButton {
  return { text, callback_data: "ignore" };
}

// ────────────────────────────────────────────────────────────
// Toggle buttons (boolean switches)
// ────────────────────────────────────────────────────────────

/** A toggle button showing on/off state. */
export function toggleButton(
  label: string,
  isEnabled: boolean,
  callbackData: string,
): InlineKeyboardButton {
  return {
    text: `${isEnabled ? "🟢" : "🔴"} ${label}: ${isEnabled ? "ON" : "OFF"}`,
    callback_data: callbackData,
  };
}

// ────────────────────────────────────────────────────────────
// Stepper buttons (numeric values)
// ────────────────────────────────────────────────────────────

/**
 * A 3-button stepper: [-] [value] [+].
 * Returns the three buttons as a single row.
 */
export function stepperRow(
  label: string,
  value: number | string,
  decCallback: string,
  incCallback: string,
  unit = "",
): readonly InlineKeyboardButton[] {
  return [
    labelButton(`📊 ${label}`),
    { text: "−", callback_data: decCallback },
    labelButton(`${value}${unit}`),
    { text: "+", callback_data: incCallback },
  ];
}

// ────────────────────────────────────────────────────────────
// Choice buttons (enum values)
// ────────────────────────────────────────────────────────────

/**
 * A row of choice buttons. The current value is marked with ✓.
 * Example: choiceRow("Language", ["auto", "en", "fa"], "en", (v) => `set:lang:${v}`)
 */
export function choiceRow<T extends string>(
  label: string,
  options: readonly T[],
  currentValue: T,
  callbackBuilder: (value: T) => string,
): readonly InlineKeyboardButton[] {
  const buttons: InlineKeyboardButton[] = options.map((option) => ({
    text: option === currentValue ? `✓ ${option}` : option,
    callback_data: callbackBuilder(option),
  }));
  // Prepend a label button if it fits.
  if (label.length <= 12) {
    return [labelButton(`📊 ${label}`), ...buttons];
  }
  return buttons;
}

// ────────────────────────────────────────────────────────────
// Keyboard builders (compose rows into a keyboard)
// ────────────────────────────────────────────────────────────

/** Build a keyboard from rows of buttons. */
export function buildKeyboard(
  rows: readonly (readonly InlineKeyboardButton[])[],
): InlineKeyboard {
  return { inline_keyboard: rows };
}

/** Build a keyboard with a single back button row at the bottom. */
export function buildKeyboardWithBack(
  rows: readonly (readonly InlineKeyboardButton[])[],
  backTarget = "menu:main",
): InlineKeyboard {
  return buildKeyboard([...rows, [backButton(backTarget)]]);
}

/** Build a keyboard with a two-button footer: [action] [back]. */
export function buildKeyboardWithFooter(
  rows: readonly (readonly InlineKeyboardButton[])[],
  action: InlineKeyboardButton,
  backTarget = "menu:main",
): InlineKeyboard {
  return buildKeyboard([...rows, [action, backButton(backTarget)]]);
}

// ────────────────────────────────────────────────────────────
// Specialized row builders
// ────────────────────────────────────────────────────────────

/** A two-button navigation row (common in the main menu). */
export function navRow(
  left: { text: string; target: string },
  right: { text: string; target: string },
): readonly InlineKeyboardButton[] {
  return [
    navButton(left.text, left.target),
    navButton(right.text, right.target),
  ];
}

/** A single-button row. */
export function singleRow(text: string, target: string): readonly InlineKeyboardButton[] {
  return [navButton(text, target)];
}

/** An "execute + back" footer for manual actions. */
export function executeBackRow(
  executeText: string,
  executeCallback: string,
  backTarget = "menu:main",
): readonly InlineKeyboardButton[] {
  return [
    { text: executeText, callback_data: executeCallback },
    backButton(backTarget),
  ];
}
