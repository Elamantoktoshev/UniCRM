-- Osh Language CRM — payment method + receipt upload migration
-- Run this once in the Supabase SQL Editor. The "receipts" Storage bucket
-- must already exist (Dashboard → Storage → receipts) before this is useful.

alter table public.payments add column if not exists payment_method text;
alter table public.payments add column if not exists receipt_path text;

-- Storage: only signed-in users (any role — manager or admin, both use real
-- Supabase Auth now) may upload or read files in the "receipts" bucket. This
-- is needed regardless of whether the bucket is marked "Public" in the
-- dashboard — uploads always go through these policies since the app only
-- ever uses the anon/authenticated key, never the service role key.
create policy "authenticated can upload receipts" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts');

create policy "authenticated can read receipts" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts');
