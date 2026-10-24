-- Make saved meals ready for multi-night plans ("dinners for the next 5
-- nights", "cook once, eat twice") before anything is stored in them.
--
-- A saved meal is now either one meal (kind 'meal', every dish on night 1)
-- or a stretch of nights (kind 'nights'). The same recipe can appear on two
-- nights — cook once, eat twice — so dishes get their own id instead of the
-- (meal, recipe) key, and each row says which night it's on.
--
-- Safe to run once on the empty tables from 011; written to be re-runnable.

alter table saved_meals add column if not exists kind text not null default 'meal';
do $$ begin
  alter table saved_meals add constraint saved_meals_kind_check check (kind in ('meal', 'nights'));
exception when duplicate_object then null;
end $$;

-- Per-night details for a multi-night plan, in order:
-- [{ label: "Mon" | "Night 2", game_plan: [...] }]. Empty for a single meal,
-- whose game plan stays in `game_plan`; for a multi-night plan, `game_plan`
-- holds the shared prep session ("Sunday, 90 min: …").
alter table saved_meals add column if not exists nights jsonb not null default '[]';

alter table saved_meal_dishes add column if not exists id uuid not null default gen_random_uuid();
alter table saved_meal_dishes add column if not exists night integer not null default 1;
-- e.g. "Leftovers from Monday — reheat gently" on a second-night dish.
alter table saved_meal_dishes add column if not exists note text;

do $$ begin
  alter table saved_meal_dishes drop constraint saved_meal_dishes_pkey;
exception when undefined_object then null;
end $$;
do $$ begin
  alter table saved_meal_dishes add primary key (id);
exception when invalid_table_definition then null;
end $$;
create unique index if not exists saved_meal_dishes_order_idx on saved_meal_dishes(meal_id, night, position);
