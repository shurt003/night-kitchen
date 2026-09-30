-- Recipe App — initial schema
-- Paste this whole file into the Supabase SQL editor and run it.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- trigram similarity (keyword search + dup check)
create extension if not exists vector;     -- pgvector (semantic search embeddings)

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type recipe_status as enum ('want_to_try', 'made', 'retired');
create type capture_status as enum ('pending', 'processing', 'ready', 'failed');
create type recipe_source_type as enum ('url', 'images', 'pdf', 'manual');
create type meal_slot as enum ('dinner');  -- room for others later
create type planned_source_type as enum ('recipe', 'quick_meal', 'freeform');
create type trip_status as enum ('open', 'archived');
create type grocery_section as enum
  ('produce', 'meat_fish', 'dairy', 'pantry', 'frozen', 'bakery', 'household', 'other');
create type grocery_source_type as enum ('manual', 'recipe', 'quick_meal', 'staple', 'ai');

-- ---------------------------------------------------------------------------
-- recipes
-- ---------------------------------------------------------------------------
create table recipes (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null default '',
  description           text not null default '',
  ingredients           jsonb not null default '[]',  -- [{raw, quantity, unit, item, note, section}]
  steps                 jsonb not null default '[]',  -- [{text, timer_seconds}]
  servings              int,
  time_total_min        int,
  time_active_min       int,
  status                recipe_status not null default 'want_to_try',
  hearts                int check (hearts between 1 and 5),
  effort                int check (effort between 1 and 5),
  notes                 text not null default '',
  tags                  text[] not null default '{}',
  cuisine               text,
  season                text[] not null default '{}',
  occasion              text[] not null default '{}',
  main_ingredients      text[] not null default '{}',
  source_url            text,
  source_name           text,
  source_type           recipe_source_type not null default 'manual',
  image_url             text,
  capture_status        capture_status not null default 'pending',
  capture_error         text,
  capture_gaps          text[] not null default '{}',  -- model-reported possible gaps → "might be incomplete" flag
  possible_duplicate_of uuid references recipes(id) on delete set null,
  raw_capture           jsonb,                          -- original payload; never destroyed
  embedding             vector(1024),                   -- voyage-3.5-lite output; null until computed
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index recipes_status_idx on recipes (status);
create index recipes_capture_status_idx on recipes (capture_status);
create index recipes_created_at_idx on recipes (created_at desc);
create index recipes_tags_gin on recipes using gin (tags);
create index recipes_main_ingredients_gin on recipes using gin (main_ingredients);
create index recipes_title_trgm on recipes using gin (title gin_trgm_ops);
create index recipes_embedding_idx on recipes
  using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- cook_log — a log of events, not a boolean
-- ---------------------------------------------------------------------------
create table cook_log (
  id             uuid primary key default gen_random_uuid(),
  recipe_id      uuid not null references recipes(id) on delete cascade,
  cooked_on      date not null default current_date,
  note           text not null default '',
  hearts_at_time int check (hearts_at_time between 1 and 5),
  created_at     timestamptz not null default now()
);
create index cook_log_recipe_idx on cook_log (recipe_id, cooked_on desc);

-- ---------------------------------------------------------------------------
-- quick_meals — reusable meals that are not recipes
-- ---------------------------------------------------------------------------
create table quick_meals (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  ingredients jsonb not null default '[]',
  times_used  int not null default 0,
  last_used   date,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- planned_meals — one row per night
-- ---------------------------------------------------------------------------
create table planned_meals (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  slot          meal_slot not null default 'dinner',
  source_type   planned_source_type not null,
  recipe_id     uuid references recipes(id) on delete set null,
  quick_meal_id uuid references quick_meals(id) on delete set null,
  title         text not null default '',    -- used for freeform
  ingredients   jsonb,                       -- freeform only
  note          text not null default '',
  reason        text not null default '',    -- why the AI picked it
  locked        boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (date, slot)
);
create index planned_meals_date_idx on planned_meals (date);

-- ---------------------------------------------------------------------------
-- grocery_trips — exactly one open trip at any time
-- ---------------------------------------------------------------------------
create table grocery_trips (
  id          uuid primary key default gen_random_uuid(),
  shop_date   date not null,
  status      trip_status not null default 'open',
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
-- enforce a single open trip
create unique index one_open_trip on grocery_trips (status) where status = 'open';

-- ---------------------------------------------------------------------------
-- grocery_items
-- ---------------------------------------------------------------------------
create table grocery_items (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references grocery_trips(id) on delete cascade,
  name              text not null,
  quantity          text not null default '',      -- free text ("2 bunches")
  section           grocery_section not null default 'other',
  checked           boolean not null default false,
  source_type       grocery_source_type not null default 'manual',
  source_id         uuid,                          -- recipe/quick_meal/staple id
  sources           jsonb not null default '[]',   -- [{type, id, label, quantity}] — preserved across merges
  carried_over_from uuid references grocery_items(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index grocery_items_trip_idx on grocery_items (trip_id);
create index grocery_items_source_idx on grocery_items (source_type, source_id);

-- ---------------------------------------------------------------------------
-- staples — standing list, not attached to any trip
-- ---------------------------------------------------------------------------
create table staples (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  section              grocery_section not null default 'other',
  typical_cadence_days int,
  last_added           date,
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- pending_captures — retry queue for failed extractions
-- ---------------------------------------------------------------------------
create table pending_captures (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references recipes(id) on delete cascade,
  payload    jsonb not null,
  attempts   int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- item_section_prefs — hand-corrections to AI categorization persist per item name
-- ---------------------------------------------------------------------------
create table item_section_prefs (
  name       text primary key,            -- normalized (lowercased, trimmed) item name
  section    grocery_section not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- usage — token usage per AI call, so costs are visible
-- ---------------------------------------------------------------------------
create table usage (
  id            uuid primary key default gen_random_uuid(),
  feature       text not null,        -- 'extract', 'categorize', 'duplicate_check', ...
  model         text not null,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  created_at    timestamptz not null default now()
);
create index usage_created_at_idx on usage (created_at desc);

-- ---------------------------------------------------------------------------
-- extraction_cache — re-saving the same URL shouldn't re-extract
-- ---------------------------------------------------------------------------
create table extraction_cache (
  url_hash   text primary key,  -- sha256 of normalized URL
  extracted  jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger recipes_updated_at before update on recipes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Semantic search RPC — cosine similarity over recipe embeddings
-- ---------------------------------------------------------------------------
create or replace function match_recipes(
  query_embedding vector(1024),
  match_count int default 20
) returns table (id uuid, similarity float) as $$
  select r.id, 1 - (r.embedding <=> query_embedding) as similarity
  from recipes r
  where r.embedding is not null
  order by r.embedding <=> query_embedding
  limit match_count;
$$ language sql stable;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Single-tenant app: the server uses the service-role key (bypasses RLS).
-- Enabling RLS with no policies means the public anon key can read nothing.
-- ---------------------------------------------------------------------------
alter table recipes            enable row level security;
alter table cook_log           enable row level security;
alter table quick_meals        enable row level security;
alter table planned_meals      enable row level security;
alter table grocery_trips      enable row level security;
alter table grocery_items      enable row level security;
alter table staples            enable row level security;
alter table pending_captures   enable row level security;
alter table item_section_prefs enable row level security;
alter table usage              enable row level security;
alter table extraction_cache   enable row level security;

-- ---------------------------------------------------------------------------
-- Storage bucket for captured images (screenshots / PDFs)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('captures', 'captures', true)
on conflict (id) do nothing;
