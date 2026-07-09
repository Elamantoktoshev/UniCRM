-- Uni Language Hub — student discount fields migration
-- Run this once in the Supabase SQL Editor against the EXISTING database.

alter table public.students add column if not exists discount_amount numeric not null default 0;
alter table public.students add column if not exists discount_note text;
