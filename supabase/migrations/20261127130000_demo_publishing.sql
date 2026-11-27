-- Demo publishing: a person can send a Gate 2-approved post to a DUMMY LinkedIn
-- profile through make.com, to show the automation. The real Upskill Today page
-- is never posted to.
--
-- Anything synced back from the dummy profile is tagged source = 'demo' and kept
-- out of every comparison, insight and learning signal, so it cannot skew stats.

alter table public.posts drop constraint posts_source_check;
alter table public.posts add constraint posts_source_check check (source in ('real', 'synthetic', 'demo'));
alter table public.post_metrics drop constraint post_metrics_source_check;
alter table public.post_metrics add constraint post_metrics_source_check check (source in ('real', 'synthetic', 'demo'));

-- Same view as before, minus demo posts. Signals, Ask ECHO, insights and learning all read it.
create or replace view public.post_performance with (security_invoker = true) as
select p.post_id, p.url, p.published_date, p.format, p.is_repost, p.text, p.char_count,
       p.hashtag_count, p.has_link, p.topic, p.objective, p.objective_status, p.source,
       m.as_of, m.impressions, m.unique_impressions, m.clicks, m.likes, m.comments, m.shares,
       case when m.impressions > 0 then m.clicks::numeric / m.impressions end as ctr,
       case when m.impressions > 0 then (m.clicks + m.likes + m.comments + m.shares)::numeric / m.impressions end as engagement_rate,
       coalesce(m.impressions, 0) >= 30 as comparable
from public.posts p
left join lateral (
  select * from public.post_metrics pm where pm.post_id = p.post_id order by pm.as_of desc limit 1
) m on true
where p.source <> 'demo';

-- One row per "Send to demo LinkedIn" click: the sync log.
create table public.publications (
  id               uuid primary key default gen_random_uuid(),
  review_item_id   uuid not null references public.review_items (id) on delete cascade,
  target           text not null default 'demo' check (target = 'demo'),  -- only the dummy profile, ever
  text             text not null,
  image_path       text,
  status           text not null default 'sending' check (status in ('sending', 'sent', 'published', 'failed')),
  callback_hash    text,             -- sha256 of the one-time token make.com sends back; cleared once used
  linkedin_post_id text,
  linkedin_url     text,
  error            text,
  requested_by     uuid references public.profiles (id),
  requested_at     timestamptz not null default now(),
  published_at     timestamptz
);
create index publications_requested_idx on public.publications (requested_at desc);

alter table public.publications enable row level security;
create policy "team read"  on public.publications for select to authenticated using (true);
create policy "team write" on public.publications for all to authenticated using (true) with check (true);
