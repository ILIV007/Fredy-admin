/**
 * src/admin/screens/soul-editor.ts
 * Soul.md editor screen. Stateful conversation for multi-line text input.
 * See ARCHITECTURE_RULES.md §12.3 (stateful conversations).
 */

import type { Screen } from "../registry";

export const soulEditorScreen: Screen = {
  id: "soul",

  async text(ctx) {
    void ctx;
    return "<b>📝 Soul.md Editor</b>\n\n<i>Scaffold — Phase 5.</i>";
  },

  keyboard() {
    return {
      inline_keyboard: [
        [{ text: "👁 View Current", callback_data: "soul:view" }],
        [{ text: "✏️ Edit", callback_data: "soul:edit" }],
        [{ text: "🔄 Reset to Default", callback_data: "soul:reset" }],
        [{ text: "🧪 Preview Sample Post", callback_data: "soul:preview" }],
        [{ text: "← Back", callback_data: "menu:main" }],
      ],
    };
  },

  async onCallback(data, ctx) {
    void ctx;
    return { toast: `Soul action: ${data}` };
  },
};
