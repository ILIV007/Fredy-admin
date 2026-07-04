# FREDY_GUIDELINES.md

> **Status:** Authoritative content publishing rules.
> **Consumers:** `FormatterService`, `QualityFilter`, `AIService` (prompt construction), `EmojiRotator`.
> **Relationship to soul.md:** soul.md defines *who* Fredy is. This file defines *how* Fredy publishes. Personality changes go in soul.md. Format changes go here.
> **Why split:** So that changing the writing tone does not require touching format rules, and changing the emoji set does not require touching personality.

---

## 1. Post Categories

Fredy publishes 4 posts per day, distributed across three categories.

| Category | Quota | Content | Tone |
|---|---|---|---|
| A | 2 / day | Programming, AI, GitHub repos, dev tools, frameworks, dev tips | Educational, practical |
| B | 1 / day | Technology news only (no politics, no general news) | Informative, "why it matters" |
| C | 1 / day | NASA APOD, dev jokes, dev quotes, dev facts | Inspiring, light, respectful |

**Category rotation rule:** Fredy tries to publish in the order A → B → A → C across the 4 daily slots. If a category's quota is met or its source has no fresh content, the next category is chosen by weight. Fredy never publishes the same category twice in a row unless it's the only option.

**Category C sub-types:** NASA is image-focused. Jokes, quotes, and facts are text-only. They rotate within the C quota so the same sub-type doesn't appear two days in a row.

---

## 2. Post Length Limits

| Field | Limit | Notes |
|---|---|---|
| Text post (no media) | 4 096 chars | Telegram hard limit |
| Caption (post with media) | 1 024 chars | Telegram hard limit |
| NASA post caption | 400 chars | Short, by design |
| Joke post | 600 chars | One-shot delivery |
| Quote post | 300 chars | Quote + author only |
| Dev fact post | 800 chars | Fact + 1-2 sentences context |
| News post | 1 500 chars | Title + why-it-matters + link |

If a generated post exceeds its limit, the QualityFilter rejects it and the pipeline retries with a tighter prompt. After 2 retries, the slot is skipped (better to skip than publish mangled content).

**Minimum length:** No post is shorter than 80 characters. Shorter posts are rejected as low-effort.

---

## 3. Telegram Markdown / HTML

Fredy publishes with `parse_mode: "HTML"`. Markdown is not used (Telegram's Markdown V2 escaping is brittle; HTML is more predictable).

### 3.1 Allowed HTML tags

| Tag | Use |
|---|---|
| `<b>...</b>` | Bold — for key terms, names, version numbers. 2–6 per post. |
| `<i>...</i>` | Italic — for short quotations, soft emphasis. Rare. |
| `<code>...</code>` | Inline code — commands, filenames, function names, package names. |
| `<pre><code>...</code></pre>` | Code blocks — multi-line code. |
| `<blockquote>...</blockquote>` | Quoted text — URLs, repo descriptions, citations. |
| `<blockquote expandable="true">...</blockquote>` | Collapsible — for long prompts, long quotes, supplementary detail. |
| `<a href="url">text</a>` | Links — always with descriptive text, never raw URL as anchor. |

### 3.2 Forbidden HTML

- `<u>`, `<s>`, `<span>`, `<div>` — not supported by Telegram.
- Nested blockquotes (Telegram renders them poorly).
- Empty tags (`<b></b>`).
- Tags inside `<code>` or `<pre>` — they render literally.

### 3.3 URL handling

Every URL goes on its own line, wrapped in `<blockquote>`:

```html
<blockquote>https://github.com/owner/repo</blockquote>
```

Or as a named link:

```html
<blockquote><a href="https://github.com/owner/repo">github.com/owner/repo</a></blockquote>
```

Long URLs (>80 chars) are always wrapped in `<blockquote expandable="true">` so they don't break the post's visual flow.

### 3.4 RTL (Persian / Arabic)

For posts in Persian or Arabic, the entire message is implicitly RTL by Telegram's detection. Fredy inserts a U+200F (RIGHT-TO-LEFT MARK) at the start of mixed-direction posts to ensure correct rendering. LTR technical terms (GitHub, API, code) are wrapped in U+202A...U+202C if they appear in the middle of RTL sentences and render incorrectly.

Half-spaces (U+200C, نیم‌فاصله) are used in Persian compound words: "می‌رود", "توسعه‌دهنده", "هوش‌مصنوعی".

---

## 4. Emoji Rules

### 4.1 Functional vs decorative

**Functional emojis (keep, regenerate, or add):**
📚 🛠️ ⚡ 💡 🔒 🌐 📦 🚀 🤖 📝 🎯 🐞 🧩 ⚠️ ✨ 📥 🔗 📊 🔧 ✅

**Decorative emojis (remove):**
🔥😍😱😂🤣😭🎉🥳🎊💎🌟💫 (and any emoji repeated 3+ times, or any emoji not on the functional list that adds no semantic value).

### 4.2 Density

- Maximum 1 functional emoji every 2–3 paragraphs.
- Maximum 6 functional emojis per post (regardless of length).
- Never stack emojis (`🔥🔥🔥` is forbidden).
- Never repeat the same emoji in one post.

### 4.3 Placement

- Before section headings: `📦 Installation`
- Before list categories: `🛠️ Tools:`
- At the start of the post (1 emoji max, optional).
- Never in the middle of a sentence.
- Never at the end of every line.

### 4.4 NASA exception

NASA posts may use one additional space-themed emoji (🌌 🪐 🌟 ☄️ 🛰️ 🔭) at the start, since they are image-focused and the emoji matches the visual.

---

## 5. Source Footer (`[emoji]Source`)

### 5.1 Format

Every post ends with exactly one line:

```
[emoji]Source
```

No space between emoji and "Source". No trailing punctuation. No link on this line (the link is in the body, in a blockquote).

### 5.2 Emoji rotation pool

```ts
const SOURCE_EMOJIS = [
  "🌌", "🚀", "🤖", "📦", "⚡", "💡", "📚", "🛠️", "🌐", "🔒",
  "🎯", "🧩", "📝", "📊", "🔗", "🔧", "✨", "🐞", "📥", "🪐",
];
```

### 5.3 Rotation logic

- The `EmojiRotator` service tracks the last 10 emojis used.
- Each new post picks the emoji from the pool whose last use is oldest.
- If all emojis in the pool have been used in the last 10 posts, pick the one with the oldest use.
- Never use the same emoji two posts in a row.
- The chosen emoji is stored in `fredy:state:<id>.last_source_emojis` (ring buffer of 10).

### 5.4 Examples

```
...post body...

🌌Source
```

```
...post body...

🚀Source
```

---

## 6. Post Structure by Category

### 6.1 Category A — Developer content

```
[optional opening emoji] Headline or hook (1 line)

Body paragraph 1 (2-4 sentences, the "what").

Body paragraph 2 (2-4 sentences, the "why it matters" or "how to use").

<blockquote>https://link-to-resource</blockquote>

[optional: <blockquote expandable="true">code example or longer detail</blockquote>]

[emoji]Source
```

**Bold usage:** the name of the tool/library/concept (e.g., `<b>Fredy</b>`) appears once, bolded. Version numbers are bolded (`<b>v0.6.1</b>`).

**Code blocks:** if the post is about a CLI tool or library, include 1 short code example (≤8 lines) showing basic usage. Longer examples go in `<blockquote expandable="true">`.

### 6.2 Category B — Tech news

```
[emoji] Headline (the news itself, 1 line)

What happened (2-3 sentences, factual).

Why it matters (2-3 sentences, Fredy's analysis — no fluff, no speculation).

<blockquote>https://source-link</blockquote>

[emoji]Source
```

**Forbidden in Category B:** politics, opinion pieces, leaked rumors without confirmation, general science news, celebrity tech gossip.

**Required:** a source link. If the news has no source, it's rejected.

### 6.3 Category C — NASA

```
[space emoji] [image, sent as photo with caption]

APOD title (1 line).

1-2 sentence caption explaining what the image shows. No deep astrophysics. No analysis.

[emoji]Source
```

**NASA posts are image-first.** The image is sent via `sendPhoto` with the caption. The caption is ≤400 chars. No blockquotes, no code blocks, no headings.

**NASA posts never share the C slot with another NASA post on consecutive days.** If yesterday was NASA, today's C slot is joke/quote/fact.

### 6.4 Category C — Joke

```
[emoji] Setup (1 line)

Punchline (1 line).

[emoji]Source
```

Jokes are short. No explanation. If the joke needs explanation, it's rejected.

**Forbidden:** jokes that mock a specific person, company, or marginalized group. Jokes about programming languages, frameworks, IDEs, debugging, and git are encouraged.

### 6.5 Category C — Quote

```
[emoji] "Quote text."

— Author

[emoji]Source
```

Quotes are ≤200 chars including author. The author line uses an em-dash (`—`), not a hyphen.

**Forbidden:** motivational-poster quotes, quotes with no attribution, quotes attributed to "Anonymous" or "Unknown".

### 6.6 Category C — Dev fact

```
[emoji] Fact statement (1 line, the surprising/interesting claim).

1-2 sentences of context or evidence.

[emoji]Source
```

Facts must be verifiable. If Fredy cannot cite a source for a fact, it's rejected. Facts are ≤800 chars total.

---

## 7. Link Display Rules

### 7.1 Always descriptive

Bad: `<a href="...">link</a>` or `<a href="...">here</a>`
Good: `<a href="...">github.com/owner/repo</a>` or `<a href="...">Cloudflare Workers docs</a>`

### 7.2 Each link on its own line

Links never appear inline in a paragraph. They are broken out into their own blockquote line. This makes the post scannable.

### 7.3 No affiliate / tracking links

If a source URL contains `?ref=`, `?utm_`, `?aff`, `?tag=`, Fredy strips these query parameters before publishing. (Stripping is done by `cleanContent`, inherited from AI Admin.)

### 7.4 GitHub URLs are kept verbatim

GitHub URLs are never shortened. The full `https://github.com/owner/repo` (or `/blob/...`, `/pull/...`, `/releases/...`) is preserved so readers can see what they're clicking.

---

## 8. Image Rules (NASA and future image sources)

### 8.1 NASA APOD

- The image is fetched from the APOD API's `hdurl` (preferred) or `url` field.
- Fredy downloads the image and sends it via `sendPhoto` (NOT as a link).
- If the APOD is a video (the API returns `media_type: "video"`), Fredy sends the YouTube URL as a link instead, with a 1-line caption.
- If the image fails to download, the slot is skipped (no fallback to text-only — NASA is image-first or nothing).

### 8.2 Future image sources

Any future source that returns images (e.g., a "screenshot of the week" source) MUST:
- Send via `sendPhoto` with the image binary, not as a link.
- Caption ≤1024 chars (Telegram's caption limit).
- Not embed the image as an HTML `<img>` (Telegram does not render those).

---

## 9. Quality Standards

### 9.1 The quality score (0–100)

Every generated post is scored by the `QualityFilter` before publishing. The score combines:

| Check | Weight | Reject if |
|---|---|---|
| Length within limits (§2) | 15 | out of range |
| Language matches requested | 15 | mismatch |
| No spam patterns (§9.2) | 20 | any match |
| Links preserved (if input had links) | 15 | links dropped |
| No duplicate (dedup hash check) | 20 | match in last 7 days |
| HTML valid (no unclosed tags) | 10 | invalid |
| Not in ALL CAPS / not in all-lowercase | 5 | matches |

The default `min_score` is 60. Posts scoring below are rejected; the pipeline retries with a tighter prompt. After 2 retries, the slot is skipped.

### 9.2 Spam patterns

Posts are rejected if they contain:
- Promotional phrases: "join", "subscribe", "follow", "don't miss", "limited time", "click here", "buy now", "DM me".
- Attribution tags: `via @xxx`, `source: @xxx`, `| @xxx`.
- 5+ consecutive hashtags.
- Telegram t.me links to other channels (allowed: links to the source itself).

### 9.3 Deduplication

The dedup hash is `sha1(first_200_chars_normalized)`, where normalization = lowercase + collapse whitespace + strip emojis + strip HTML. The hash is stored in `fredy:dedup:<hash>` with a 7-day TTL. On collision, the post is rejected as a duplicate.

### 9.4 Rejection criteria (hard rejects)

The following cause immediate rejection regardless of score:
- AI output is empty or only whitespace.
- AI output is shorter than 50 chars.
- AI output contains the literal string "As an AI language model" or "I cannot fulfill this request".
- AI output contains the input prompt reflected back (a sign of model confusion).
- AI output is in a different script than the requested language (e.g., requested `fa`, output is all Cyrillic).

---

## 10. Post Element Order

The canonical order of elements in a Fredy post:

1. **Opening emoji** (optional, 1 max) — only if it adds semantic value.
2. **Headline or hook** (1 line, optionally bolded).
3. **Body paragraphs** (2–4 paragraphs, varying length).
4. **Code block or example** (optional, Category A only).
5. **Links** (each in its own blockquote, on its own line).
6. **Collapsible detail** (optional, in `<blockquote expandable="true">`).
7. **Footer line** — exactly `[emoji]Source`, no other text on this line.

Empty line between each section. No more than one empty line in a row.

NASA posts are the exception: image first, then caption, then footer. No headings, no body paragraphs.

---

## 11. Footer (channel attribution)

The channel footer (`🌀 @ILIVIR3`) is appended by the `FormatterService` AFTER the `[emoji]Source` line, on a new line, only for non-NASA posts. NASA posts have no channel footer (the image is the brand).

Format:

```
...post body...

[emoji]Source
🌀 @ILIVIR3
```

The footer text is configurable in `fredy:settings.footer`. The default is `🌀 @ILIVIR3`.

---

## 12. Manual Post Overrides

When the admin triggers a manual post via the admin panel, the following overrides apply:

- The admin can specify a category explicitly (bypasses the rotation).
- The admin can specify a source explicitly (bypasses the source manager's pick).
- The admin can edit the generated text before publishing (the QualityFilter still runs, but with `min_score: 0` — the admin's edits are trusted).
- The manual post counts toward the daily quota unless the admin unchecks "count toward quota".

---

## 13. Simulation Mode

When the admin or debug dashboard runs `simulate/post` or `simulate/slot`:
- The full pipeline runs (fetch → generate → soul-inject → quality-filter).
- The post is NOT published.
- The output includes: the final text, the quality score, the rejected checks (if any), the AI provider/model used, and the trace (per-stage timings).
- The simulation does NOT consume the daily quota.
- The simulation does NOT update the dedup hash (so the same content can be simulated repeatedly).

---

## 14. What Fredy Never Publishes

- Content that has appeared in the channel in the last 7 days (dedup).
- Content shorter than 80 chars (low effort).
- Content with broken HTML (unclosed tags, nested blockquotes).
- Content in the wrong language.
- Content that is purely promotional.
- Content with no source link (Categories A and B require a source; C sub-types vary).
- Content that exceeds its length limit after 2 retry attempts.
- Content the AI refused to generate (e.g., safety filter triggered).
- NASA content on two consecutive C slots.
- The same source on two consecutive slots (anti-repeat).

---

**End of `FREDY_GUIDELINES.md`.**
