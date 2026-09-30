-- Multi-user Phase 1: users + per-row ownership. SCHEMA ONLY.
-- Seeding your row and backfilling existing data are run manually (they carry
-- your password and capture key, so they don't belong in the committed repo) —
-- see docs/MULTI_USER_PLAN.md and the snippet handed over alongside this file.
--
-- Isolation is enforced in APP CODE, not RLS: the server uses the service-role
-- key, which bypasses RLS. These user_id columns are what every owned-table
-- query filters on. Nullable for now; a later migration (Phase 3) makes them
-- NOT NULL once the filtering is proven, and swaps the global one_open_trip
-- constraint to per-user.

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  password    text not null,              -- shared-secret model, same as APP_PASSWORD today
  capture_key text not null unique,       -- per-user x-api-key for the iOS Shortcut
  created_at  timestamptz not null default now()
);
alter table users enable row level security;  -- matches the other tables; service role bypasses it

-- Owned roots. Children (grocery_items, pending_captures) are scoped through
-- their parent trip/recipe, so they don't need their own column.
alter table recipes        add column if not exists user_id uuid references users(id);
alter table quick_meals    add column if not exists user_id uuid references users(id);
alter table planned_meals  add column if not exists user_id uuid references users(id);
alter table grocery_trips  add column if not exists user_id uuid references users(id);
alter table staples        add column if not exists user_id uuid references users(id);
alter table usage          add column if not exists user_id uuid references users(id);

create index if not exists recipes_user_idx       on recipes(user_id);
create index if not exists quick_meals_user_idx   on quick_meals(user_id);
create index if not exists planned_meals_user_idx on planned_meals(user_id);
create index if not exists grocery_trips_user_idx on grocery_trips(user_id);
create index if not exists staples_user_idx       on staples(user_id);
create index if not exists usage_user_idx         on usage(user_id);
