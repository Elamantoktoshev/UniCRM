-- Osh Language CRM — Supabase schema
-- Run this in the Supabase SQL Editor (once). It creates the 6 tables that back
-- the app's data model (crm-groups, crm-students, crm-managers, crm-teachers,
-- crm-activity-log from localStorage become groups/students/payments/managers/
-- teachers/activity_log here). Payments used to live embedded inside each
-- student's `payments` array; they now live in their own table with a
-- student_id foreign key, joined back together client-side.
--
-- IDs stay as plain text (matching the app's existing uid() generator:
-- Date.now().toString(36) + random suffix) rather than uuid, so no client code
-- has to change how it generates or references IDs.

create table if not exists public.groups (
  id text primary key,
  level text not null,
  name text not null,
  teacher text not null default '-',
  time text not null default '-',
  max_size integer not null default 15,
  status text not null default 'active',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id text primary key,
  name text not null,
  phone text not null default '',
  level text not null,
  group_id text references public.groups(id) on delete set null,
  manager text not null default '',
  contract_amount numeric not null default 0,
  status text not null default 'active',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  amount numeric not null,
  date date,
  note text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.managers (
  name text primary key
);

create table if not exists public.teachers (
  name text primary key
);

create table if not exists public.activity_log (
  id text primary key,
  "timestamp" timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text
);

create index if not exists students_group_id_idx on public.students (group_id);
create index if not exists payments_student_id_idx on public.payments (student_id);
create index if not exists activity_log_timestamp_idx on public.activity_log ("timestamp" desc);

-- Row Level Security: this app has no real backend auth (roles are a simple
-- client-side picker, not Supabase Auth), so every table is opened up fully
-- to the anon key — same trust model as the previous localStorage version,
-- just shared instead of per-browser. Anyone with the anon key can read/write.
-- If you later add real Supabase Auth, tighten these policies accordingly.

alter table public.groups enable row level security;
alter table public.students enable row level security;
alter table public.payments enable row level security;
alter table public.managers enable row level security;
alter table public.teachers enable row level security;
alter table public.activity_log enable row level security;

create policy "public read/write" on public.groups for all using (true) with check (true);
create policy "public read/write" on public.students for all using (true) with check (true);
create policy "public read/write" on public.payments for all using (true) with check (true);
create policy "public read/write" on public.managers for all using (true) with check (true);
create policy "public read/write" on public.teachers for all using (true) with check (true);
create policy "public read/write" on public.activity_log for all using (true) with check (true);
