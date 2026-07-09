-- Osh Language CRM — Supabase Auth migration
-- Run this once in the Supabase SQL Editor. It adds the `profiles` table that
-- maps a Supabase Auth user (auth.users.id) to this app's role/manager_name.
-- Auth itself (users, passwords, sessions) is fully handled by Supabase Auth
-- (Dashboard → Authentication → Users) — this table is just the app-specific
-- metadata layered on top of it.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'manager')),
  manager_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Each signed-in user can read only their own profile row — enough for the
-- app to figure out its own role/manager_name right after login. There is
-- deliberately no insert/update/delete policy for the anon/authenticated
-- role: profile rows are created and edited by the admin directly in the SQL
-- Editor (see the examples below), which runs as the table owner and
-- bypasses RLS — not through the app itself.
create policy "users read own profile" on public.profiles
  for select using (auth.uid() = id);

-- ---------------------------------------------------------------------
-- After creating each user in Dashboard → Authentication → Users → Add user,
-- copy their "User UID" from that same screen and insert a matching row here.
-- Run one insert per user, with the real UID/manager_name substituted in.
-- ---------------------------------------------------------------------

-- Example: a manager account (repeat once per manager, matching a name from
-- the `managers` table — Диана / Венера / Алия / Эламан / Анжелика):
-- insert into public.profiles (id, role, manager_name) values
--   ('<uid-из-authentication>', 'manager', 'Диана');

-- Example: the super-admin account (manager_name stays null):
-- insert into public.profiles (id, role, manager_name) values
--   ('<uid-из-authentication>', 'admin', null);
