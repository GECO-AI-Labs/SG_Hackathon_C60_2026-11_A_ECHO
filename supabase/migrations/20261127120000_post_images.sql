-- An optional image for a post draft. Added on the Write page or at Gate 2,
-- stored in a private bucket. Only the storage path lives on the draft.
alter table public.review_items add column image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', false, 8388608, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

create policy "team post images read"   on storage.objects for select to authenticated using (bucket_id = 'post-images');
create policy "team post images write"  on storage.objects for insert to authenticated with check (bucket_id = 'post-images');
create policy "team post images delete" on storage.objects for delete to authenticated using (bucket_id = 'post-images');
