-- Multi-user Phase 3 — ADDITIVE structural changes. Run BEFORE deploying the
-- Phase 3 code. Deliberately additive: it ADDS the per-user constraints the new
-- code needs while LEAVING the old global ones in place, so nothing breaks in
-- the window between running this and the new deploy going live. The old
-- constraints (and the NOT NULL flip) are removed later in 007, after the
-- two-account test and right before real friends are added.
--
-- Safe to run while only the first (owner) user exists: for a single user, the old global
-- constraints and the new per-user ones are satisfied by the same rows.

-- 1. grocery_items gets its own user_id (denormalized) — some grocery ops act on
--    items by id/source_id and can't cleanly scope through the parent trip.
alter table grocery_items add column if not exists user_id uuid references users(id);
update grocery_items gi
  set user_id = gt.user_id
  from grocery_trips gt
  where gi.trip_id = gt.id and gi.user_id is null;
create index if not exists grocery_items_user_idx on grocery_items(user_id);

-- 2. Sweep anything unowned (captures made before the code stamped user_id).
update recipes       set user_id = (select id from users order by created_at limit 1) where user_id is null;
update quick_meals   set user_id = (select id from users order by created_at limit 1) where user_id is null;
update planned_meals set user_id = (select id from users order by created_at limit 1) where user_id is null;
update grocery_trips set user_id = (select id from users order by created_at limit 1) where user_id is null;
update staples       set user_id = (select id from users order by created_at limit 1) where user_id is null;
update grocery_items set user_id = (select id from users order by created_at limit 1) where user_id is null;

-- 3. Per-user open trip — ADDED alongside the global one_open_trip (kept for now).
create unique index if not exists one_open_trip_per_user
  on grocery_trips (user_id) where status = 'open';

-- 4. Per-user planned-meal slot — ADDED alongside the old unique(date,slot).
create unique index if not exists planned_meals_user_date_slot
  on planned_meals (user_id, date, slot);
