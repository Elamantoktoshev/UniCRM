-- Uni Language Hub — group days-of-week field migration
-- Run this once in the Supabase SQL Editor against the EXISTING database.
-- Stored as a plain comma-separated string (e.g. "Пн,Вт,Ср,Чт,Пт"), same
-- flat-text-field convention as every other group column.

alter table public.groups add column if not exists days text not null default 'Пн,Вт,Ср,Чт,Пт';
