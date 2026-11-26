-- ECHO schema v1
-- Five core areas: library (materials + chunks), posts + metrics,
-- review items (all 4 gates), rules (learning loop), and an audit trail.
-- Every data table has a `source` column: 'real' or 'synthetic'.

create extension if not exists vector with schema extensions;

-- ─────────────────────────────────────────────────────────────
-- Shared enums (kept as CHECK constraints so they are easy to edit)
-- ─────────────────────────────────────────────────────────────
-- objective: the five content objectives from the brief
--   awareness | thought_leadership | engagement | lead_generation | campaign
-- objective_status: 'inferred' until a person confirms it at Gate 1 or 3

-- ─────────────────────────────────────────────────────────────
-- People (one row per login). Filled by trigger on auth.users.
-- ─────────────────────────────────────────────────────────────
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role         text not null default 'reviewer' check (role in ('owner', 'reviewer')),
  created_at   timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- LinkedIn posts (one row per post). Text + classification.
-- ─────────────────────────────────────────────────────────────
create table public.posts (
  post_id          text primary key,                 -- LinkedIn URN, e.g. urn:li:share:123
  url              text unique,
  published_date   date not null,
  format           text not null,                    -- image | video | document | multiImage | article | poll | reference | text
  is_repost        boolean not null default false,
  text             text not null default '',
  char_count       int,
  hashtag_count    int,
  has_link         boolean,
  topic            text,
  objective        text check (objective in ('awareness','thought_leadership','engagement','lead_generation','campaign')),
  objective_status text not null default 'inferred' check (objective_status in ('inferred','confirmed')),
  source           text not null default 'real' check (source in ('real','synthetic')),
  created_at       timestamptz not null default now()
);

-- Lifetime stats per post, one row per report snapshot (supports several reporting periods).
create table public.post_metrics (
  post_id            text not null references public.posts (post_id) on delete cascade,
  as_of              date not null,
  impressions        int,
  unique_impressions int,
  clicks             int,
  likes              int,
  comments           int,
  shares             int,
  source             text not null default 'real' check (source in ('real','synthetic')),
  imported_via       text not null default 'csv' check (imported_via in ('csv','make','manual','seed')),
  primary key (post_id, as_of)
);

-- Page-level daily totals (all three daily files merged on date).
create table public.page_daily (
  date               date primary key,
  impressions        int,
  unique_impressions int,
  clicks             int,
  likes              int,
  comments           int,
  shares             int,
  new_followers      int,
  page_views         int,
  source             text not null default 'real' check (source in ('real','synthetic'))
);

-- Page-wide follower breakdown. There is NO per-post audience data.
create table public.follower_demographics (
  dimension          text not null,      -- Seniority | Function | Industry | StaffCount | Country | AssociationType
  value              text not null,
  raw_id             text,
  organic_followers  int not null default 0,
  paid_followers     int not null default 0,
  as_of              date not null default current_date,
  source             text not null default 'real' check (source in ('real','synthetic')),
  primary key (dimension, value, as_of)
);

-- Brand voice + page profile (single row, key = 'brand').
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Content library (Gate 1). A material is a whole document;
-- chunks are the searchable pieces with embeddings.
-- ─────────────────────────────────────────────────────────────
create table public.materials (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('linkedin_post','article','brochure','campaign_brief','deck','transcript','brand_voice','other')),
  title            text not null,
  body             text not null,
  post_id          text references public.posts (post_id) on delete set null,
  file_path        text,                               -- Supabase Storage path for uploads
  topic            text,
  tags             text[] not null default '{}',
  objective        text check (objective in ('awareness','thought_leadership','engagement','lead_generation','campaign')),
  objective_status text not null default 'inferred' check (objective_status in ('inferred','confirmed')),
  library_status   text not null default 'pending' check (library_status in ('pending','approved','rejected')),
  published_date   date,
  source           text not null default 'real' check (source in ('real','synthetic')),
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now()
);
create index materials_kind_idx on public.materials (kind);
create unique index materials_post_id_idx on public.materials (post_id) where post_id is not null;

create table public.material_chunks (
  id           bigint generated always as identity primary key,
  material_id  uuid not null references public.materials (id) on delete cascade,
  chunk_index  int not null,
  content      text not null,
  embedding    extensions.vector(1024),               -- text-embedding-v4, 1024 dims
  fts          tsvector generated always as (to_tsvector('english', content)) stored,
  unique (material_id, chunk_index)
);
create index material_chunks_embedding_idx on public.material_chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index material_chunks_fts_idx on public.material_chunks using gin (fts);

-- Hybrid search: vector similarity, with a small keyword boost.
create function public.match_chunks(
  query_embedding extensions.vector(1024),
  query_text      text default '',
  match_count     int default 8,
  kinds           text[] default null,
  approved_only   boolean default true
) returns table (
  chunk_id       bigint,
  material_id    uuid,
  title          text,
  kind           text,
  source         text,
  post_id        text,
  published_date date,
  content        text,
  similarity     float
)
language sql stable set search_path = public, extensions as $$
  select c.id, m.id, m.title, m.kind, m.source, m.post_id, m.published_date, c.content,
         (1 - (c.embedding <=> query_embedding))
           + case when query_text <> '' and c.fts @@ websearch_to_tsquery('english', query_text) then 0.05 else 0 end
           as similarity
  from material_chunks c
  join materials m on m.id = c.material_id
  where c.embedding is not null
    and (kinds is null or m.kind = any (kinds))
    and (not approved_only or m.library_status = 'approved')
  order by similarity desc
  limit match_count
$$;

-- ─────────────────────────────────────────────────────────────
-- Review queue: ONE table for all four gates.
--   gate 1 classification | gate 2 post_draft | gate 3 objective_metrics | gate 4 insight
-- ─────────────────────────────────────────────────────────────
create table public.review_items (
  id               uuid primary key default gen_random_uuid(),
  gate             smallint not null check (gate between 1 and 4),
  item_type        text not null check (item_type in ('classification','post_draft','objective_metrics','insight')),
  status           text not null default 'pending' check (status in ('pending','approved','edited','rejected','superseded')),
  title            text not null,
  reason           text,                -- why the AI made this item ("from recommendation X")
  brief            text,                -- what was asked for
  draft            text,                -- AI output as text (post body, insight text)
  payload          jsonb not null default '{}',   -- structured AI output: alternatives, objective, metrics, evidence…
  citations        jsonb not null default '[]',   -- [{n, material_id, title, kind, snippet}]
  context          jsonb not null default '{}',   -- {topic, format, objective, audience}
  learning         jsonb not null default '{}',   -- what learning went into the prompt: {rule_ids, example_ids, with_learning}
  confidence       numeric,             -- 0..1 estimated approval chance
  final            text,                -- what the reviewer approved (after edits)
  edit_distance    int,                 -- character-level Levenshtein draft→final
  edit_ratio       numeric,             -- edit_distance / length(draft)
  decision_reason  text check (decision_reason in ('off_brand_tone','wrong_claim','wrong_angle','duplicate','already_known','other')),
  decision_note    text,
  decided_by       uuid references public.profiles (id),
  decided_at       timestamptz,
  seconds_to_decide int,
  material_id      uuid references public.materials (id) on delete set null,
  post_id          text references public.posts (post_id) on delete set null,
  parent_id        uuid references public.review_items (id) on delete set null,  -- "request another angle" chain
  held_out         boolean not null default false,  -- reserved for the before/after learning proof
  source           text not null default 'real' check (source in ('real','synthetic')),
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now()
);
create index review_items_queue_idx on public.review_items (status, gate, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- Learned rules. Active rules go into every prompt of that item type.
-- ─────────────────────────────────────────────────────────────
create table public.rules (
  id             uuid primary key default gen_random_uuid(),
  item_type      text not null default 'post_draft' check (item_type in ('classification','post_draft','objective_metrics','insight')),
  rule           text not null,              -- "Do not open with a question."
  rationale      text,                       -- why ECHO thinks so
  evidence_ids   uuid[] not null default '{}',  -- review_items that taught it
  active         boolean not null default true,
  origin         text not null default 'extracted' check (origin in ('extracted','manual')),
  source         text not null default 'real' check (source in ('real','synthetic')),
  created_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id),
  updated_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Audit trail: who did what, when. Every gate decision, rule toggle,
-- upload and autonomy change writes one row.
-- ─────────────────────────────────────────────────────────────
create table public.events (
  id          bigint generated always as identity primary key,
  actor       uuid references public.profiles (id),
  action      text not null,     -- e.g. review.approved, rule.disabled, upload.csv
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}',
  at          timestamptz not null default now()
);
create index events_at_idx on public.events (at desc);

-- Autonomy ladder level per item type (0 draft only, 1 batch approve, 2 auto-run).
create table public.autonomy (
  item_type  text primary key check (item_type in ('classification','post_draft','objective_metrics','insight')),
  level      smallint not null default 0 check (level between 0 and 2),
  max_level  smallint not null default 2,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  check (level <= max_level)
);
insert into public.autonomy (item_type, level, max_level) values
  ('classification', 0, 2), ('post_draft', 0, 1),  -- post drafts never above Level 1 (brief rule)
  ('objective_metrics', 0, 1), ('insight', 0, 1);

-- ─────────────────────────────────────────────────────────────
-- Views used by the dashboard
-- ─────────────────────────────────────────────────────────────
-- Latest snapshot per post + derived rates. `comparable` = at least 30 impressions
-- (posts below that are excluded from comparisons; rates explode on tiny bases).
create view public.post_performance with (security_invoker = true) as
select p.post_id, p.url, p.published_date, p.format, p.is_repost, p.text, p.char_count,
       p.hashtag_count, p.has_link, p.topic, p.objective, p.objective_status, p.source,
       m.as_of, m.impressions, m.unique_impressions, m.clicks, m.likes, m.comments, m.shares,
       case when m.impressions > 0 then m.clicks::numeric / m.impressions end as ctr,
       case when m.impressions > 0 then (m.clicks + m.likes + m.comments + m.shares)::numeric / m.impressions end as engagement_rate,
       coalesce(m.impressions, 0) >= 30 as comparable
from public.posts p
left join lateral (
  select * from public.post_metrics pm where pm.post_id = p.post_id order by pm.as_of desc limit 1
) m on true;

-- Trust panel numbers per item type.
create view public.trust_stats with (security_invoker = true) as
select item_type,
       count(*) filter (where status in ('approved','edited','rejected'))                       as decided,
       count(*) filter (where status = 'approved')                                               as approved_unedited,
       count(*) filter (where status = 'edited')                                                 as edited,
       count(*) filter (where status = 'rejected')                                               as rejected,
       round(avg(edit_ratio) filter (where status in ('approved','edited')), 3)                  as avg_edit_ratio,
       round(avg(seconds_to_decide) filter (where seconds_to_decide is not null))                as avg_seconds
from public.review_items
group by item_type;

-- ─────────────────────────────────────────────────────────────
-- Row level security: logged-in team members can read and write.
-- Nobody anonymous can read anything. (Hackathon-grade, one team.)
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['profiles','posts','post_metrics','page_daily','follower_demographics','settings',
                           'materials','material_chunks','review_items','rules','events','autonomy']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "team read" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "team write" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Private bucket for uploaded library files.
insert into storage.buckets (id, name, public) values ('library', 'library', false)
on conflict (id) do nothing;
create policy "team files read"  on storage.objects for select to authenticated using (bucket_id = 'library');
create policy "team files write" on storage.objects for insert to authenticated with check (bucket_id = 'library');
