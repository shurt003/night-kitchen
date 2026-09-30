-- The planner already estimates active time for invented "idea" nights
-- (freeform rows with no recipe behind them) — it just had nowhere to land.
-- Recipe/quick-meal nights keep showing time from their joined row; this is
-- only for freeform, so it stays null everywhere else.
alter table planned_meals add column if not exists time_active_min integer;
