-- Uni Language Hub — student profile fields + payment editing migration
-- Run this once in the Supabase SQL Editor against the EXISTING database.
--
-- Adds: parent phone / address / lead source (+ referrer name when the
-- source is "Друг привёл") to students, and a new admin-editable `sources`
-- table (mirrors managers/teachers). Payment editing (admin-only) and the
-- explicit "payment date" vs "recognition month" fields need NO schema
-- change — `payments.date` and `payments.recognition_start_month` already
-- exist (added by migration_finance.sql) and are simply now exposed as
-- editable form fields client-side instead of only being auto-set.

alter table public.students add column if not exists parent_phone text not null default '';
alter table public.students add column if not exists address text not null default '';
alter table public.students add column if not exists source text not null default '';
alter table public.students add column if not exists referrer_name text;

create table if not exists public.sources (
  name text primary key
);

insert into public.sources (name) values
  ('Инстаграм'), ('Рекомендация'), ('Друг привёл'), ('Другое')
on conflict (name) do nothing;

alter table public.sources enable row level security;

create policy "public read/write" on public.sources for all using (true) with check (true);
