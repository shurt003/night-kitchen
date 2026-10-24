-- Saved meals: a Make meal kept together — its dishes, its game plan, and
-- (optionally) what time dinner is. The dishes stay ordinary recipes in the
-- library; this only records that they belong together and in what order.
--
-- Isolation is enforced in app code like every other owned table (the server
-- uses the service-role key); RLS on with no policies so the anon key reads
-- nothing.

create table if not exists saved_meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  title       text not null,
  request     text,                                  -- what was asked for; context for swapping a dish
  servings    integer,
  -- [{ offset_min: number|null, label: text, text: text }] — offset_min is
  -- minutes before serving (null for "to serve"), which lets the page turn a
  -- dinner time into clock times without asking the model again.
  game_plan   jsonb not null default '[]',
  serve_time  time,                                  -- "dinner at 7:00"; null until set
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table saved_meals enable row level security;
create index if not exists saved_meals_user_idx on saved_meals(user_id);

-- Which recipes make up a meal, in serving order. Deleting a recipe drops it
-- from the meal rather than leaving a dangling id; deleting the meal leaves
-- the recipes alone (they were saved in their own right).
create table if not exists saved_meal_dishes (
  meal_id    uuid not null references saved_meals(id) on delete cascade,
  recipe_id  uuid not null references recipes(id) on delete cascade,
  position   integer not null,
  primary key (meal_id, recipe_id)
);
alter table saved_meal_dishes enable row level security;
create index if not exists saved_meal_dishes_recipe_idx on saved_meal_dishes(recipe_id);
