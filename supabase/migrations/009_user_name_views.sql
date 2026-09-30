-- Browsing convenience only — no app code reads these. Every owned table stores
-- user_id as a UUID, which is unreadable when you're poking around the Table
-- Editor trying to see what someone else has been up to. These views put the
-- owner's name in the first column and otherwise pass the table through
-- untouched.
--
-- Two deliberate safety choices, because these tables are effectively
-- unprotected: RLS is enabled on them but no policies exist (isolation is
-- enforced in app code, which uses the service-role key — see 004_users.sql).
--
--   1. They live in `admin`, not `public`. PostgREST only exposes the schemas
--      it's configured with (public by default), so nothing here is reachable
--      over the REST API with an anon key.
--   2. security_invoker = true. A normal view runs with its OWNER's privileges
--      and would bypass the underlying tables' RLS; with security_invoker the
--      caller's own permissions apply, so even if `admin` were ever exposed,
--      an anon caller hits RLS-with-no-policies and sees nothing.
--
-- Read-only in practice: a joined view isn't auto-updatable, so edit rows in
-- the real table and use these to look.

create schema if not exists admin;

-- Belt and braces. New schemas grant nothing to these roles by default; this
-- states the intent so a future `grant ... on all schemas` can't quietly widen it.
revoke all on schema admin from anon, authenticated;

-- left join throughout: user_id is NOT NULL on most of these as of 007, but a
-- row that somehow lost its owner should still show up here rather than vanish
-- from the view — that's exactly the kind of thing you'd want to spot.

create or replace view admin.recipes_with_user with (security_invoker = true) as
  select u.name as user_name, r.* from recipes r left join users u on u.id = r.user_id;

create or replace view admin.quick_meals_with_user with (security_invoker = true) as
  select u.name as user_name, q.* from quick_meals q left join users u on u.id = q.user_id;

create or replace view admin.planned_meals_with_user with (security_invoker = true) as
  select u.name as user_name, p.* from planned_meals p left join users u on u.id = p.user_id;

create or replace view admin.grocery_trips_with_user with (security_invoker = true) as
  select u.name as user_name, t.* from grocery_trips t left join users u on u.id = t.user_id;

create or replace view admin.grocery_items_with_user with (security_invoker = true) as
  select u.name as user_name, g.* from grocery_items g left join users u on u.id = g.user_id;

create or replace view admin.staples_with_user with (security_invoker = true) as
  select u.name as user_name, s.* from staples s left join users u on u.id = s.user_id;

-- usage never got the NOT NULL treatment in 007, so unowned rows are expected
-- here (anything logged before the stamping code shipped).
create or replace view admin.usage_with_user with (security_invoker = true) as
  select u.name as user_name, x.* from usage x left join users u on u.id = x.user_id;

revoke all on all tables in schema admin from anon, authenticated;
