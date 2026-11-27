-- Better library search.
-- 1. Skip near-empty chunks: under 60 characters once hashtags are removed
--    (e.g. "Agree? #Career #Work" matched every query).
-- 2. Small boost (+0.03) for posts from the last 12 months and for curated documents.
-- 3. search_library adds filters and returns topic, goal and latest stats for the Library page.

create or replace function public.match_chunks(
  query_embedding extensions.vector(1024),
  query_text      text default '',
  match_count     int default 8,
  kinds           text[] default null,
  approved_only   boolean default true
) returns table (
  chunk_id bigint, material_id uuid, title text, kind text, source text, post_id text,
  published_date date, content text, similarity float
)
language sql stable set search_path = public, extensions as $$
  select c.id, m.id, m.title, m.kind, m.source, m.post_id, m.published_date, c.content,
         (1 - (c.embedding <=> query_embedding))
           + case when query_text <> '' and c.fts @@ websearch_to_tsquery('english', query_text) then 0.05 else 0 end
           + case when m.kind <> 'linkedin_post' or m.published_date > current_date - 365 then 0.03 else 0 end
           as similarity
  from material_chunks c
  join materials m on m.id = c.material_id
  where c.embedding is not null
    and length(regexp_replace(c.content, '#\S+', '', 'g')) >= 60
    and (kinds is null or m.kind = any (kinds))
    and (not approved_only or m.library_status = 'approved')
  order by similarity desc
  limit match_count
$$;

create or replace function public.search_library(
  query_embedding extensions.vector(1024),
  query_text      text default '',
  match_count     int default 40,
  kinds           text[] default null,
  topics          text[] default null,
  from_date       date default null
) returns table (
  chunk_id bigint, material_id uuid, title text, kind text, source text, post_id text,
  published_date date, topic text, objective text, objective_status text, library_status text,
  content text, similarity float, impressions int, clicks int
)
language sql stable set search_path = public, extensions as $$
  select c.id, m.id, m.title, m.kind, m.source, m.post_id, m.published_date, m.topic, m.objective,
         m.objective_status, m.library_status, c.content,
         (1 - (c.embedding <=> query_embedding))
           + case when query_text <> '' and c.fts @@ websearch_to_tsquery('english', query_text) then 0.05 else 0 end
           + case when m.kind <> 'linkedin_post' or m.published_date > current_date - 365 then 0.03 else 0 end
           as similarity,
         pm.impressions, pm.clicks
  from material_chunks c
  join materials m on m.id = c.material_id
  left join lateral (
    select x.impressions, x.clicks from post_metrics x where x.post_id = m.post_id order by x.as_of desc limit 1
  ) pm on true
  where c.embedding is not null
    and length(regexp_replace(c.content, '#\S+', '', 'g')) >= 60
    and (kinds is null or m.kind = any (kinds))
    and (topics is null or m.topic = any (topics))
    and (from_date is null or m.published_date is null or m.published_date >= from_date)
  order by similarity desc
  limit match_count
$$;
