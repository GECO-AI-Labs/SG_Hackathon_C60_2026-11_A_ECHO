# ECHO: Every Content Hits Objectives

An AI desk for LinkedIn content. ECHO drafts posts from the company's own material, reads what performed, and learns from every approval, edit and rejection. A marketing manager approves everything at four gates. Nothing is published automatically.

Hackathon project · Cohort 60 · Track 3 "Prototype the Future" · Team A (Content Management) · Pitch: Wed 9 Dec 2026.

---

## The five screens

| Screen | What you do there | Gate |
|---|---|---|
| **Desk** | Review everything the AI prepared: approve, edit, reject or refine a draft ("shorter", "warmer"). Keys: `j`/`k` move, `a` approve, `e` edit, `r` reject. Batch approval appears once a task type earns Level 1 | 1–4 |
| **Write** | Brief a new post, or start from an approved insight. ECHO searches the library and writes 2 versions with numbered sources | 2 |
| **Library** | Search past posts and documents by meaning, with filters (type, topic, date) and sorting. Open any result to read it in full with its LinkedIn stats, then "Write a post from this" to repurpose it. Upload PDF, Word, PowerPoint or text | 1 |
| **Signals** | Did posts hit their goal, comparisons by format and topic, trends, LinkedIn report upload, Ask ECHO | 3, 4 |
| **Ledger** | What ECHO learned (rules you can switch off), trust per task, proof it improves, audit trail | – |

**The loop in one line:** upload material → ECHO tags it (G1) → ask for insights (G4) → brief a post from an insight → ECHO drafts with sources (G2) → confirm the success metrics (G3) → your edits become rules → the next draft is better.

### What is live, what is mocked

| Live (real AI, real data) | Synthetic (labelled in the app) | Not built yet |
|---|---|---|
| Library search over 618 real posts with filters, item view and repurposing; upload PDF, Word, PowerPoint, text | 3 reference documents (brochure, campaign brief, founder talk) | Confidence score per draft |
| All 618 posts classified into 9 topics with inferred objectives (Gate 1) | 36 past reviewer decisions that seed learning | Level 2 auto-run |
| Drafting with citations, 2 versions, conversational refinement | | make.com scenario + dummy LinkedIn page (teammate) |
| All 4 gates with audit trail; batch approval once Level 1 is earned | | Separate data per LinkedIn page |
| Results against objectives: did each post hit its goal? | | |
| Dashboard by format and topic, calendar-month KPIs | | |
| Ask ECHO: direct answers, trend kept apart from explanation | | |
| LinkedIn XLSX/CSV upload as reporting periods, make.com webhook | | |
| Rule extraction (posts and classifications), results-weighted examples | | |
| Learning proof: house-rule mistakes drop by about 70% after learning | | |

---

## Run it on your computer

You need: **Node.js 22+** ([download](https://nodejs.org)), **Git**, and either **Docker Desktop** (for a local database) or the team's cloud database keys.

1. **Get the code**

   ```bash
   git clone https://github.com/GECO-AI-Labs/SG_Hackathon_C60_2026-11_A_ECHO.git echo
   cd echo
   npm install
   ```

2. **Get the secrets.** Ask the team lead for a `.env.local` file and put it in the `echo` folder. It holds the AI key and database keys. **Never commit it, paste it in chat or share it in screenshots.** The template is `.env.example`.

3. **Pick a database**

   - **Shared cloud database (easiest):** the team lead's `.env.local` already points to it. Skip to step 5.
   - **Your own local database:** start Docker Desktop, then run `npm run db:start`. Copy the `API_URL`, `PUBLISHABLE_KEY` and `SECRET_KEY` it prints into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.

4. **Fill a local database** (skip for the cloud one; it is already filled)

   ```bash
   npm run load:data -- --embed   # real data from data/clean (ask the team lead for this folder)
   npm run seed:synthetic         # fake reviewer history + sample documents
   npm run classify               # tags every post with a topic and objective (~3 min)
   npm run proof                  # learns rules and runs the before/after test (~4 min)
   ```

   No `data/clean` folder? Run only `seed:synthetic`. The app works, with an empty dashboard.

5. **Create your login**

   ```bash
   npm run user:create -- you@example.com "Your Name" choose-a-password
   ```

6. **Start the app:** `npm run dev`, then open <http://localhost:3000>.

---

## Continuing with Claude Code (or Cursor, Copilot, etc.)

The AI rules for this project live in `AGENTS.md` (Claude Code also reads `CLAUDE.md`, which points there). Good ways to ask:

- "Read AGENTS.md. Then add a 'shorter' button to the draft card that asks ECHO to rewrite the selected version under 80 words."
- "In Signals, add a date-range filter to the post table. Keep the 30-impression rule."
- "Explain how a draft is built, step by step, using src/lib/echo/draft.ts."

Before you push, ask the assistant to run `npm run typecheck && npm run lint && npm run build`.

---

## How it works (short version)

```
Browser ── Next.js app (screens + server actions) ── Supabase (Postgres + pgvector + login)
                         │
                         └── Alibaba Model Studio: qwen4-max (writing) · text-embedding-v4 (search)
```

**Drafting (RAG):** the brief is turned into a vector and matched against the library. The top matches, the brand voice, the active house rules and 3 of the reviewer's past edits go into one prompt. The model must mark every claim with a source number like `[2]`. The draft lands on the Desk.

**Learning (no model training):**

1. Every decision is stored: draft, final, the difference, the reason, who, when and how long it took.
2. "Learn from recent decisions" asks the AI to group repeated corrections into rules ("Never open with a question"). You can switch each rule off on the Ledger.
3. Active rules and recent before/after edits go into every new prompt.
4. Pre-flight checks (plain code, not AI) show on each draft: statement opener, max 3 hashtags, no hype words, has a link, under 150 words.
5. **Proof:** 5 seeded decisions are held back. `npm run proof` drafts them with and without learning and counts failed checks.
6. **Autonomy ladder:** each task type earns Level 1 (batch approve) at 90% unedited approvals over 20+ items. Post drafts never go above Level 1.
7. **Results-weighted examples:** when a new report arrives, approved drafts are matched to the posts actually published. Edits on posts that performed well count more as examples.

**Metrics:** engagement rate = (clicks + reactions + comments + reposts) ÷ impressions. CTR = clicks ÷ impressions. All definitions are on the Signals page and in `src/lib/domain.ts`.

---

## Where things live

```
src/app/(desk)/        one folder per screen (desk, write, library, signals, ledger)
src/app/actions.ts     every button that saves something
src/app/api/ingest/    webhook for make.com
src/components/echo/   ECHO screens and parts
src/lib/echo/          the engine: library, draft, learning, analyse, checks, ingest
src/lib/ai.ts          the only file that talks to the AI provider
src/lib/domain.ts      objectives, metric definitions, data rules
supabase/migrations/   database tables
scripts/               load data, seed, create users, learning proof
data/synthetic/        fake data (in git)
data/clean, data/raw   real data (NOT in git, ask the team lead)
```

---

## Data rules (from the brief)

- **Real data is internal GECO data.** The repo is public, so `data/clean` and `data/raw` are never committed. They live in the database and on the team lead's machine.
- Synthetic rows have `source = synthetic` and a dashed "synthetic" tag in the app.
- Posts with **fewer than 30 impressions** are left out of comparisons.
- Formats with fewer than 10 posts (article, document, poll) are marked low-sample.
- LinkedIn gives no per-post audience data, so ECHO never assumes engagement came from outside the company.
- Stats exist only from about 2025 onwards. Older posts are used as writing material only.

---

## Common tasks

| I want to… | Do this |
|---|---|
| Change the AI model | Edit `LLM_MODEL` in `.env.local`, restart `npm run dev` |
| Change colours or fonts | `src/app/globals.css` (colours) and `src/app/layout.tsx` (fonts) |
| Add a table or column | New file in `supabase/migrations/`, then `npm run db:reset` (local) or `npm run db:push` (cloud) |
| Wipe and refill my local database | `npm run db:reset`, then step 4 above |
| Re-run the learning proof | `npm run proof` |
| Classify posts by topic and objective | `npm run classify` (add `-- --retopic` for a fresh topic list) |
| Import a new LinkedIn report | Signals → "Upload LinkedIn report": LinkedIn's own XLSX export or a CSV. You see a match report before anything is saved |

### make.com

A make.com scenario can push LinkedIn data straight in:

```
POST https://<your-app>/api/ingest
Header: x-echo-secret: <INGEST_SECRET from .env.local>
Body:   { "as_of": "2026-11-26", "posts": [ { "post_id": "urn:li:share:…", "url": "…", "published_date": "2026-11-25",
          "format": "image", "text": "…", "impressions": 120, "clicks": 4, "likes": 6, "comments": 0, "shares": 1 } ] }
```

The reply is a match report: `{ received, matched, added, metrics, skipped }`.

---

## Put it online (team lead)

1. **Supabase cloud:** create a project at [supabase.com](https://supabase.com) (region: Singapore). Then:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npm run db:push
   ```

   In the dashboard, go to **Authentication → Sign In / Providers** and turn **off "Allow new users to sign up"**. Logins are created only with `npm run user:create`.
2. Put the cloud URL and keys in `.env.local`. Run step 4 (load, seed, proof) and step 5 (users) once.
3. **Vercel:** import the GitHub repo at [vercel.com](https://vercel.com/new), and add every variable from `.env.example` with the real values.
4. In Supabase, go to **Authentication → URL Configuration** and set the Site URL to the Vercel address.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Missing NEXT_PUBLIC_SUPABASE_URL" | `.env.local` is missing or in the wrong folder |
| Login says the password doesn't match | Create the user again with `npm run user:create` |
| "Access denied by API-Key restrictions" | That model isn't enabled for our key. Use `qwen4-max`, `qwen3.8-max` or `text-embedding-v4` |
| "The AI answer was cut off" | Raise `maxTokens` for that call in `src/lib/echo/*` |
| Drafts take ~20–40 s | Normal with thinking mode. Set `LLM_MODEL=qwen3.8-max` for faster, plainer drafts |
| `db:start` fails | Start Docker Desktop first |
