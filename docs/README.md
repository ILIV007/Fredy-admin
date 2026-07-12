# Fredy — Documentation Index

> **Purpose:** This folder holds all Fredy foundation documents. Each file has a clear scope and a defined "consumer". Files are layered by how often they're sent to the AI agent during prompt chains.

---

## File Inventory

| File | Scope | Always sent? |
|---|---|---|
| `ARCHITECTURE_RULES.md` | Project constitution: layering, modules, plugins, SOLID, TypeScript, storage, error handling, naming, performance, audit lessons. | Level 1 (subset) |
| `soul.md` | Fredy's personality, voice, philosophy, audience, quality intent. | Level 1 |
| `FREDY_GUIDELINES.md` | Content publishing rules: per-category format, length limits, HTML rules, emoji rotation, source footer, quality scoring. | Level 2 (content / AI / formatter prompts) |
| `../fredy-prompt-0.5-engineering-report.md` | Reverse-engineering audit of AI Admin v0.6.1. Reference only; not sent in routine prompts. | Level 3 (reference) |

Future documents (created on demand as their phase arrives):

| Future file | Scope | Created in |
|---|---|---|
| `API_GUIDELINES.md` | Content source plugin contract, fetch patterns, caching, rate limits, error handling per source. | Phase 3 (Content Engine) |
| `SCHEDULER_SPEC.md` | Slot computation, jitter, cron triggers, anti-repeat, queue management. | Phase 4 (Scheduler) |
| `AI_PROVIDER_SPEC.md` | AIProvider interface, prompt assembly, soul injection, multi-model race, fallback chain. | Phase 2 (AI layer) |
| `ADMIN_PANEL_SPEC.md` | Screen registry, command registry, stateful conversations, navigation tree. | Phase 5 (Admin Panel) |
| `DEBUG_SPEC.md` | Debug endpoints, simulation mode, log structure, dashboard cards. | Phase 6 (Debug) |
| `ROADMAP.md` | Phase-by-phase implementation plan with checkpoints. | Updated continuously |
| `decisions/*.md` | Architecture decision records (ADRs) — one per non-obvious choice. | Created as decisions are made |

---

## Context Layering System

Sending every document to the AI on every prompt wastes tokens and dilutes focus. Fredy uses a 3-tier layering scheme.

### Level 1 — Always sent (foundation)

Sent with **every** prompt in the chain. Kept intentionally short.

**Contents:**
- `ARCHITECTURE_RULES.md` — the rules apply everywhere.
- `soul.md` — Fredy's voice applies everywhere.

**Token budget:** ~3 000 tokens combined. These two files should be concise enough to fit comfortably. If they grow past 5 000 tokens combined, prune them.

### Level 2 — Sent when relevant (phase-specific)

Sent only with prompts that touch the relevant phase.

**Examples:**
- Building the AI layer → also send `FREDY_GUIDELINES.md` (because prompts must follow the format rules).
- Building a content source → also send `API_GUIDELINES.md` (once it exists).
- Building the scheduler → also send `SCHEDULER_SPEC.md` (once it exists).
- Building the admin panel → also send `ADMIN_PANEL_SPEC.md` (once it exists).

**Token budget:** ~2 000–4 000 tokens per phase doc. Keep them focused.

### Level 3 — Reference (not sent unless explicitly needed)

The full audit report, decision records, the AI Admin source code. These are referenced by the agent when it needs to recall *why* a rule exists or *how* AI Admin solved a similar problem, but they are not in the routine context.

**How to use:** if a prompt asks "why did we decide X?", the agent can be told "consult `docs/decisions/X.md`" and the file is loaded for that turn only.

---

## Recommended Prompt Chain Structure

```
Prompt 0  (reverse engineering)
   ├── AI Admin source code (Level 3 reference)
   └── Output: fredy-prompt-0.5-engineering-report.md

Prompt 0.5 (this — foundation files)
   ├── AI Admin source code (Level 3 reference)
   └── Output: ARCHITECTURE_RULES.md, soul.md, FREDY_GUIDELINES.md, this README

Prompt 1  (architecture design)
   ├── Level 1: ARCHITECTURE_RULES.md, soul.md
   ├── Level 2: FREDY_GUIDELINES.md (because pipeline touches content rules)
   └── Output: folder tree, module descriptions, diagrams

Prompt 2  (folder scaffolding + container)
   ├── Level 1: ARCHITECTURE_RULES.md, soul.md
   └── Output: src/ skeleton, container.ts, types.ts

Prompt 3  (Telegram service + KV store)
   ├── Level 1: ARCHITECTURE_RULES.md, soul.md
   └── Output: services/telegram.ts, services/kv-store.ts

Prompt 4  (Soul loader + AI service)
   ├── Level 1: ARCHITECTURE_RULES.md, soul.md
   ├── Level 2: FREDY_GUIDELINES.md, AI_PROVIDER_SPEC.md
   └── Output: services/soul-loader.ts, services/ai-service.ts, providers/*

Prompt 5  (Content sources)
   ├── Level 1: ARCHITECTURE_RULES.md, soul.md
   ├── Level 2: API_GUIDELINES.md
   └── Output: plugins/sources/*.ts

Prompt 6  (Scheduler + pipeline + quality filter)
   ├── Level 1: ARCHITECTURE_RULES.md, soul.md
   ├── Level 2: FREDY_GUIDELINES.md, SCHEDULER_SPEC.md
   └── Output: orchestrators/pipeline.ts, services/scheduler.ts, services/quality-filter.ts

Prompt 7  (Admin panel)
   ├── Level 1: ARCHITECTURE_RULES.md, soul.md
   ├── Level 2: ADMIN_PANEL_SPEC.md
   └── Output: orchestrators/admin.ts, admin/screens/*.ts

Prompt 8  (Debug system)
   ├── Level 1: ARCHITECTURE_RULES.md, soul.md
   ├── Level 2: DEBUG_SPEC.md
   └── Output: services/debug.ts, entry/debug.ts

Prompt 9  (Hardening, tests, CI)
   ├── Level 1: ARCHITECTURE_RULES.md, soul.md
   └── Output: tests/*, .github/workflows/*
```

The principle: **each prompt receives only what it needs to do its job well.** If a prompt's output depends on a rule, the rule's file is sent. If not, it isn't.

---

## How to Extend the Docs

When adding a new document:

1. Decide its layer (1, 2, or 3). If unsure, default to Level 2.
2. Add a row to the "File Inventory" table above.
3. If Level 1, prune something else to keep the combined budget under ~5 000 tokens.
4. If Level 2, note which phase(s) it accompanies.
5. If Level 3, note how to discover it (e.g., "consulted when discussing X").

When modifying an existing document:

1. If the change is additive (new rule, new section), just add it.
2. If the change is a reversal (old rule was wrong), create `decisions/<topic>.md` explaining the reversal, then update the doc to reference the decision.
3. Never silently delete a rule. The audit trail matters.

---

## File Relationships (dependency graph)

```
                  ARCHITECTURE_RULES.md
                         │
                         │ governs
                         ▼
              ┌─────────────────────┐
              │                     │
              ▼                     ▼
          soul.md          FREDY_GUIDELINES.md
              │                     │
              │ personality         │ format
              │                     │
              └──────────┬──────────┘
                         │
                         ▼
              AIService injects soul.md
              FormatterService applies FREDY_GUIDELINES.md
              QualityFilter enforces FREDY_GUIDELINES.md §9
              EmojiRotator enforces FREDY_GUIDELINES.md §5
                         │
                         │
                         ▼
              Published post on @ILIVIR3
```

`soul.md` and `FREDY_GUIDELINES.md` are independent: changing one does not require changing the other. `ARCHITECTURE_RULES.md` governs how they're loaded, injected, and consumed — it sits above both.

---

**End of `docs/README.md`.**
