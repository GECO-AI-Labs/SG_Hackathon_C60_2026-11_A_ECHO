<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ECHO: guide for AI coding assistants

Read `README.md` first for what ECHO is and how to run it. This file is the rules for changing the code.

## Map

| Where | What |
|---|---|
| `src/app/(desk)/*/page.tsx` | Server pages: load data, pass it to a view component |
| `src/components/echo/*` | ECHO screens and pieces (client components) |
| `src/components/ui/*` | shadcn/ui primitives. Restyle through tokens, not per component |
| `src/app/actions.ts` | Every button that changes data (server actions) |
| `src/lib/echo/*` | The engine: `library` (RAG), `draft`, `learning`, `analyse`, `checks`, `ingest` |
| `src/lib/ai.ts` | The only place that calls the AI provider |
| `src/lib/domain.ts` | Objectives, metric definitions, gates, data rules. UI and prompts both read it |
| `supabase/migrations/*.sql` | Database schema. Add a NEW migration file; never edit an applied one |
| `scripts/*` | Load data, seed synthetic data, create users, learning proof |
| `data/synthetic/` | Fake data, committed. `data/clean` and `data/raw` are real and NOT in git |

## Rules from the brief (never break)

1. Every gate decision records who, when, what changed and why (`decide()` in `actions.ts` + `events` table).
2. No auto-publish. Nothing posts to LinkedIn. Approval only marks content ready.
3. Every draft cites library sources (`[n]` markers → `citations` column).
4. AI-inferred objectives show "inferred" until a person confirms them.
5. Insights keep `observed_trend` separate from `possible_explanation`. Never state cause.
6. Do not treat engagement as external. Only page-level audience data exists.
7. Posts with < 30 impressions are excluded from comparisons (`DATA_RULES` in `domain.ts`).
8. Synthetic rows have `source = 'synthetic'` and show a "synthetic" tag in the UI.
9. Post drafts never go above autonomy Level 1.

## Conventions

- Server-only code imports `"server-only"`. Scripts run with `tsx --conditions=react-server` so they can import it.
- New AI calls go through `chat()` / `chatJSON()` / `embed()` in `src/lib/ai.ts`. Thinking tokens count toward `max_tokens`, so keep limits generous for `tier: "smart"`.
- Cut text with `clip()` / `headline()` from `src/lib/edit.ts`, never `.slice()` alone: half an emoji breaks Postgres JSON.
- Colours, radius and fonts are tokens in `src/app/globals.css`. Use `text-pencil`, `bg-card`, `border-border`, `.kicker`, `.num`. Do not hard-code hex values in components.
- Charts: Recharts through `src/components/ui/chart.tsx`, colours `var(--chart-1..5)` (validated for colour-blind safety). One y-axis per chart.
- Check work with `npm run typecheck && npm run lint && npm run build`.

## Safety

- The GitHub repo is PUBLIC. Never commit `.env*` (except `.env.example`), `data/clean`, `data/raw`, `make/`, or API keys.
- Never print secrets in logs or commit messages.
