-- Osh Language CRM — Finance module migration
-- Run this once in the Supabase SQL Editor against the EXISTING database
-- (the one that already has groups/students/payments/managers/teachers/
-- activity_log from the earlier schema.sql). It only adds what's new for
-- the P&L / revenue-recognition / expenses / refunds feature, so it won't
-- collide with policies you already created on the original 6 tables.

-- Revenue recognition columns on the existing payments table: the payment's
-- amount is split evenly across course_duration_months, starting at
-- recognition_start_month ("YYYY-MM"). Cash accounting (how much money
-- actually landed, and when) still comes straight from amount/date and is
-- untouched by this.
alter table public.payments add column if not exists course_duration_months integer not null default 1;
alter table public.payments add column if not exists recognition_start_month text;

-- Backfill existing payments: plain one-month recognition starting the
-- month the payment was made.
update public.payments
set recognition_start_month = to_char(date, 'YYYY-MM')
where recognition_start_month is null and date is not null;

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

create index if not exists expenses_month_idx on public.expenses (month);
create index if not exists expenses_overrides_idx on public.expenses (overrides_expense_id);

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

create index if not exists revenue_adjustments_month_idx on public.revenue_adjustments (month);

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.revenue_adjustments enable row level security;

create policy "public read/write" on public.expense_categories for all using (true) with check (true);
create policy "public read/write" on public.expenses for all using (true) with check (true);
create policy "public read/write" on public.revenue_adjustments for all using (true) with check (true);
