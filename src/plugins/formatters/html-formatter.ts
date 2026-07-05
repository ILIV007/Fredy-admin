/**
 * src/plugins/formatters/html-formatter.ts
 * HTML formatter plugin — converts AI-generated text into Telegram-ready HTML.
 *
 * Ported from AI Admin v0.6.9 src/formatter.js htmlEngine with TypeScript types.
 *
 * Formatting pipeline:
 *   Phase 1: PROTECT — extract code blocks, inline code, markdown links, existing HTML
 *   Phase 2: STRIP + ESCAPE — strip decorative emojis, escape HTML, convert URLs to <a>
 *   Phase 3: MARKDOWN TRANSFORMS — **bold**, *italic*, ~~strike~~, # headings, bullets
 *   Phase 4: NUMBERED STEPS — group into blockquote with number emojis (1️⃣ 2️⃣ 3️⃣)
 *   Phase 5: QUOTE LIST ITEMS — heading + description → blockquote
 *   Phase 6: QUOTE LONG PARAGRAPHS — wrap in <blockquote> (skip first eligible)
 *   Phase 7: RESTORE PROTECTED CONTENT — code blocks, inline code, links
 *   Phase 8: POLISH — collapse extra newlines, append footer, validate HTML
 */

import type { Formatter } from "../../types/plugin";
import type { FormatInput, FormatResult } from "../../services/formatter";
import {
  escapeHtml,
  shortenUrl,
  trimUrlPunctuation,
  validateAndFixHtml,
} from "../../primitives/html";

const URL_SPLIT_REGEX = /https?:\/\/(?:(?!https?:\/\/)[^\s<>"'])+/gi;

const FUNCTIONAL_EMOJIS = new Set([
  "🛠️","🚀","🤖","📚","⚡","🔒","🌐","📦","💡","📝","🎯","🐞","🧩","⚠️","✨","📥","🔗","📊","🔧","✅","❌",
]);

const NUMBER_EMOJIS = ["0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];

const DECORATIVE_EMOJI_REGEX = /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA70}-\u{1FAFF}]/gu;

/** Strip decorative emojis while preserving functional ones. */
function stripDecorativeEmojis(text: string): string {
  const fp: string[] = [];
  let p = text;
  for (const e of FUNCTIONAL_EMOJIS) {
    fp.push(e);
    p = p.split(e).join(`\u0000F${fp.length - 1}\u0000`);
  }
  for (let i = 0; i <= 10; i++) {
    fp.push(NUMBER_EMOJIS[i]!);
    p = p.split(NUMBER_EMOJIS[i]!, `\u0000N${i}\u0000`);
  }
  let r = p.replace(DECORATIVE_EMOJI_REGEX, "");
  r = r.replace(/\u0000F(\d+)\u0000/g, (_, i) => [...FUNCTIONAL_EMOJIS][parseInt(i)] ?? "");
  r = r.replace(/\u0000N(\d+)\u0000/g, (_, i) => NUMBER_EMOJIS[parseInt(i)] ?? "");
  return r.replace(/  +/g, " ");
}

export class HtmlFormatter implements Formatter {
  readonly name = "html";

  format(input: FormatInput): FormatResult {
    const text = input.text;
    if (!text || !text.trim()) return { text: "", parseMode: "HTML" };

    let work = text;

    // === PHASE 1: PROTECT ===

    // 1. Code blocks (```...```)
    const codeBlocks: string[] = [];
    work = work.replace(/```([\s\S]*?)```/g, (_, code: string) => {
      codeBlocks.push(code.replace(/^\n+|\n+$/g, ""));
      return `\n§CB${codeBlocks.length - 1}§\n`;
    });

    // 2. Inline code (`...`)
    const inlineCodes: string[] = [];
    work = work.replace(/`([^`\n]+)`/g, (_, code: string) => {
      inlineCodes.push(code);
      return ` §IC${inlineCodes.length - 1}§ `;
    });

    // 3. Markdown links [text](url)
    const linkPlaceholders: Array<{ text: string; url: string }> = [];
    work = work.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, linkText: string, url: string) => {
      linkPlaceholders.push({ text: linkText, url });
      return ` §L${linkPlaceholders.length - 1}§ `;
    });

    // 4. Protect existing HTML tags (from AI output)
    const htmlTags: string[] = [];
    work = work.replace(/<a\s+[^>]*>[\s\S]*?<\/a>/gi, (match: string) => {
      htmlTags.push(match);
      return ` §H${htmlTags.length - 1}§ `;
    });
    work = work.replace(/<\/?(?:b|i|u|s|code|pre|blockquote|br)\s*\/?>/gi, (match: string) => {
      htmlTags.push(match);
      return ` §H${htmlTags.length - 1}§ `;
    });

    // 5. Remove angle brackets around bare URLs
    work = work.replace(/<(https?:\/\/[^\s>]+)>/g, "$1");

    // === PHASE 2: STRIP + ESCAPE + URLS ===
    work = stripDecorativeEmojis(work);
    work = escapeHtml(work);

    // 6. Plain URLs → <a href> with shortened label
    work = work.replace(URL_SPLIT_REGEX, (urlRaw: string) => {
      const url = trimUrlPunctuation(urlRaw);
      const label = shortenUrl(url);
      return `<a href="${url}">${escapeHtml(label)}</a>`;
    });

    // 7. Restore markdown links as <a href>
    work = work.replace(/§L(\d+)§/g, (_, i: string) => {
      const link = linkPlaceholders[Number(i)];
      if (!link) return "";
      return `<a href="${link.url}">${escapeHtml(link.text)}</a>`;
    });

    // 8. Restore protected HTML tags
    work = work.replace(/§H(\d+)§/g, (_, i: string) => htmlTags[Number(i)] ?? "");

    // === PHASE 3: MARKDOWN TRANSFORMS ===
    // Bold
    work = work.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    // Italic (not inside **)
    work = work.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<i>$1</i>");
    // Strikethrough
    work = work.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
    // Headings (# Heading → <b>Heading</b>)
    work = work.replace(/^#{1,3}\s+(.+)$/gm, "<b>$1</b>");
    // Bullet lists (- item or * item → • item)
    work = work.replace(/^[\s]*[-•*]\s+(.+)$/gm, "• $1");

    // === PHASE 4: NUMBERED STEPS — group into blockquote ===
    {
      const lines = work.split("\n");
      const out: string[] = [];
      let group: string[] = [];
      for (const line of lines) {
        const m = line.match(/^(\d+)[.)]\s+(.+)$/);
        if (m) {
          const n = parseInt(m[1]!);
          const emoji = (n >= 0 && n <= 10) ? NUMBER_EMOJIS[n] : `${n}.`;
          group.push(`${emoji} ${m[2]}`);
        } else {
          if (group.length > 0) {
            out.push(`<blockquote>${group.join("\n")}</blockquote>`);
            group = [];
          }
          out.push(line);
        }
      }
      if (group.length > 0) out.push(`<blockquote>${group.join("\n")}</blockquote>`);
      work = out.join("\n");
    }

    // === PHASE 5: QUOTE LIST ITEMS (heading + description → blockquote) ===
    {
      const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "");

      const isColonHeading = (line: string): boolean => {
        const t = line.trim();
        if (!t || t.startsWith("<blockquote>") || t.startsWith("§")) return false;
        const inner = stripTags(t).trim();
        if (!inner) return false;
        if (/^راه[\-\s\u200C]?حل\s*[:：]/.test(inner)) return true;
        if (inner.length > 3 && inner.length < 150 && /[:：]\s*$/.test(inner)) return true;
        return false;
      };

      const lines = work.split("\n");
      const out: string[] = [];
      let i = 0;
      while (i < lines.length) {
        if (isColonHeading(lines[i]!)) {
          out.push(lines[i]!); // Heading stays OUTSIDE blockquote
          i++;
          const block: string[] = [];
          while (i < lines.length) {
            const t = lines[i]!.trim();
            if (t === "") break;
            if (isColonHeading(lines[i]!)) break;
            block.push(lines[i]!);
            i++;
          }
          if (block.length > 0) {
            out.push(`<blockquote>${block.join("\n")}</blockquote>`);
          }
        } else {
          out.push(lines[i]!);
          i++;
        }
      }
      work = out.join("\n");
    }

    // === PHASE 6: QUOTE LONG PARAGRAPHS (skip first eligible) ===
    {
      const minLen = 120;
      const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "");
      const lines = work.split("\n");
      let firstIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i]!.trim();
        if (!t || t.startsWith("§")) continue;
        if (t.startsWith("<blockquote>") || t.startsWith("</blockquote>")) continue;
        const inner = stripTags(t).trim();
        if (inner.length < minLen) continue;
        if (/^[•\-\*\d]/.test(inner)) continue;
        if ((inner.match(/[.!?؟!]/g) || []).length < 2) continue;
        firstIdx = i;
        break;
      }
      work = lines.map((line, i) => {
        const t = line.trim();
        if (!t || t.startsWith("§")) return line;
        if (t.startsWith("<blockquote>") || t.startsWith("</blockquote>")) return line;
        const inner = stripTags(t).trim();
        if (inner.length < minLen) return line;
        if (/^[•\-\*\d]/.test(inner)) return line;
        if ((inner.match(/[.!?؟!]/g) || []).length < 2) return line;
        if (i === firstIdx) return line;
        return `<blockquote>${t}</blockquote>`;
      }).join("\n");
    }

    // === PHASE 7: RESTORE PROTECTED CONTENT ===
    work = work.replace(/§IC(\d+)§/g, (_, i: string) => `<code>${escapeHtml(inlineCodes[Number(i)] ?? "")}</code>`);
    work = work.replace(/§CB(\d+)§/g, (_, i: string) => `<pre><code>${escapeHtml(codeBlocks[Number(i)] ?? "")}</code></pre>`);

    // === PHASE 8: POLISH ===
    // Collapse extra newlines.
    work = work.replace(/\n{3,}/g, "\n\n");

    // Append footer if provided.
    if (input.sourceUrl) {
      work = `${work}\n\n<blockquote>${input.sourceUrl}</blockquote>`;
    }

    // Append source footer.
    if (input.sourceEmoji) {
      work = `${work}\n\n${input.sourceEmoji}Source`;
    }

    // Validate and fix HTML.
    work = validateAndFixHtml(work.trim());

    return { text: work, parseMode: "HTML" };
  }
}
