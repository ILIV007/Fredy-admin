/**
 * src/plugins/formatters/html-formatter.ts
 * HTML formatter plugin. Produces Telegram HTML from AI-generated text.
 * Reused pattern from AI Admin src/formatter.js (will be ported in Phase 6).
 */

import type { Formatter } from "../../types/plugin";
import type { FormatInput, FormatResult } from "../../services/formatter";

export class HtmlFormatter implements Formatter {
  readonly name = "html";

  format(input: FormatInput): FormatResult {
    // TODO: implement in Phase 6 — port from AI Admin src/formatter.js.
    // Steps:
    //   1. Split into paragraphs (blank-line separated).
    //   2. Detect headings (lines ending with `:`).
    //   3. Wrap URLs in <blockquote>.
    //   4. Wrap code blocks in <pre><code>.
    //   5. Bold key terms.
    //   6. Append footer: [emoji]Source\n🌀 @ILIVIR3
    void input;
    return { text: "", parseMode: "HTML" };
  }
}
