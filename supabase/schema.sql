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
  created_at timestamptz not null default now(),
  parent_phone text not null default '',
  address text not null default '',
  source text not null default '',
  referrer_name text,
  discount_amount numeric not null default 0,
  discount_note text
);

create table if not exists public.payments (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  amount numeric not null,
  date date,
  note text default '',
  created_at timestamptz not null default now()
);

-- Revenue recognition (added on top of the original payments table): the
-- payment's amount is split evenly across course_duration_months, starting
-- at recognition_start_month ("YYYY-MM"). Cash accounting (how much money
-- actually landed, and when) still comes straight from amount/date above and
-- is untouched by this. `add column if not exists` makes this safe to run
-- again against a database that already has the base payments table.
alter table public.payments add column if not exists course_duration_months integer not null default 1;
alter table public.payments add column if not exists recognition_start_month text;

-- Backfill for rows that predate the revenue-recognition columns: a plain
-- one-month recognition starting the month the payment was made.
update public.payments
set recognition_start_month = to_char(date, 'YYYY-MM')
where recognition_start_month is null and date is not null;

create table if not exists public.managers (
  name text primary key
);

create table if not exists public.teachers (
  name text primary key
);

create table if not exists public.sources (
  name text primary key
);

insert into public.sources (name) values
  ('Инстаграм'), ('Рекомендация'), ('Друг привёл'), ('Другое')
on conflict (name) do nothing;

create table if not exists public.activity_log (
  id text primary key,
  "timestamp" timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text
);

-- Expense categories live under one of 5 fixed, non-editable P&L groups
-- (the group set itself is a client-side constant — "fixed" / "payroll" /
-- "marketing" / "admin" / "cogs" — not stored anywhere else). Refunds are
-- deliberately NOT a category here: they're a revenue adjustment instead
-- (see revenue_adjustments below), not an expense.
create table if not exists public.expense_categories (
  name text primary key,
  group_key text not null default 'admin'
);

insert into public.expense_categories (name, group_key) values
  ('Аренда', 'fixed'), ('Коммунальные услуги', 'fixed'), ('Подписки', 'fixed'), ('Амортизация', 'fixed'),
  ('Зарплата', 'payroll'),
  ('Маркетинг и реклама', 'marketing'), ('Кэшбек', 'marketing'),
  ('Офисные расходы', 'admin'), ('Прочие расходы', 'admin'),
  ('Образование', 'cogs'), ('Активити', 'cogs')
on conflict (name) do update set group_key = excluded.group_key;

create table if not exists public.expenses (
  id text primary key,
  category text not null,
  amount numeric not null,
  month text not null, -- "YYYY-MM"
  note text not null default '',
  is_recurring boolean not null default false,
  -- Non-null only on a per-month override row: points back at the recurring
  -- template it overrides for that one `month`, leaving the template itself
  -- (and every other month) unchanged.
  overrides_expense_id text references public.expenses(id) on delete cascade,
  created_by text not null default '',
  created_at timestamptz not null default now()
);

-- Refunds: a correction to recognized revenue in a given month, not an
-- expense line. Optionally linked to the student it was refunded to.
create table if not exists public.revenue_adjustments (
  id text primary key,
  student_id text references public.students(id) on delete set null,
  amount numeric not null,
  month text not null, -- "YYYY-MM"
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);

-- Maps a real Supabase Auth user (auth.users.id) to this app's role/
-- manager_name. Auth itself (users, passwords, sessions) is handled entirely
-- by Supabase Auth (Dashboard → Authentication → Users); this table is just
-- the app-specific metadata on top of it. Rows here are inserted by hand in
-- the SQL Editor after creating each user — see migration_auth.sql.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'manager')),
  manager_name text,
  created_at timestamptz not null default now()
);

create index if not exists students_group_id_idx on public.students (group_id);
create index if not exists payments_student_id_idx on public.payments (student_id);
create index if not exists activity_log_timestamp_idx on public.activity_log ("timestamp" desc);
create index if not exists expenses_month_idx on public.expenses (month);
create index if not exists expenses_overrides_idx on public.expenses (overrides_expense_id);
create index if not exists revenue_adjustments_month_idx on public.revenue_adjustments (month);

-- Row Level Security: app data (groups/students/payments/…) has no
-- per-row ownership model, so those tables stay open to the anon key —
-- access control is enforced client-side by role (admin vs manager), the
-- same as before. Real Supabase Auth is only used to establish *who* is
-- signed in (see profiles below), not to restrict these tables' rows.

alter table public.groups enable row level security;
alter table public.students enable row level security;
alter table public.payments enable row level security;
alter table public.managers enable row level security;
alter table public.teachers enable row level security;
alter table public.sources enable row level security;
alter table public.activity_log enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.revenue_adjustments enable row level security;
alter table public.profiles enable row level security;

create policy "public read/write" on public.groups for all using (true) with check (true);
create policy "public read/write" on public.students for all using (true) with check (true);
create policy "public read/write" on public.payments for all using (true) with check (true);
create policy "public read/write" on public.managers for all using (true) with check (true);
create policy "public read/write" on public.teachers for all using (true) with check (true);
create policy "public read/write" on public.sources for all using (true) with check (true);
create policy "public read/write" on public.activity_log for all using (true) with check (true);
create policy "public read/write" on public.expense_categories for all using (true) with check (true);
create policy "public read/write" on public.expenses for all using (true) with check (true);
create policy "public read/write" on public.revenue_adjustments for all using (true) with check (true);

-- profiles is the one table that IS access-controlled: a signed-in user can
-- only read their own row (there's no insert/update policy for it at all —
-- profile rows are managed by hand in the SQL Editor, see migration_auth.sql).
create policy "users read own profile" on public.profiles
  for select using (auth.uid() = id);

-- Note: this file is safe to re-run in full against a database that already
-- has the original 6 tables — every statement above uses "if not exists" /
-- "on conflict do nothing", except the RLS "create policy" lines, which will
-- error if the policy already exists. If you already ran the pre-finance
-- version of this file, skip straight to the "Revenue recognition" and
-- "expense_categories"/"expenses" blocks instead of running the whole file.
