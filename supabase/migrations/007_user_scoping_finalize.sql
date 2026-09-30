-- Multi-user Phase 3 — CONTRACT step. Run AFTER the Phase 3 code is deployed and
-- the two-account test passes, and BEFORE adding real friends. Drops the old
-- global constraints (which would break with a second user) and makes user_id
-- NOT NULL now that every write stamps it.

-- Re-sweep in case anything was captured during the deploy window by the old
-- (pre-stamp) code. No-op if clean.
update recipes       set user_id = (select id from users order by created_at limit 1) where user_id is null;
update quick_meals   set user_id = (select id from users order by created_at limit 1) where user_id is null;
update planned_meals set user_id = (select id from users order by created_at limit 1) where user_id is null;
update grocery_trips set user_id = (select id from users order by created_at limit 1) where user_id is null;
update staples       set user_id = (select id from users order by created_at limit 1) where user_id is null;
update grocery_items set user_id = (select id from users order by created_at limit 1) where user_id is null;

-- Drop the global constraints — a second user's open trip / same-night plan
-- would violate these.
drop index if exists one_open_trip;
alter table planned_meals drop constraint if exists planned_meals_date_slot_key;

-- Lock ownership in: every row must belong to someone.
alter table recipes        alter column user_id set not null;
alter table quick_meals    alter column user_id set not null;
alter table planned_meals  alter column user_id set not null;
alter table grocery_trips  alter column user_id set not null;
alter table staples        alter column user_id set not null;
alter table grocery_items  alter column user_id set not null;
