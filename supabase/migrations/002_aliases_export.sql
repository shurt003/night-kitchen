-- Migration 002 — ingredient canonicalization
-- Paste into the Supabase SQL editor and run (after 001).

-- "scallions" and "green onions" are the same thing. Haiku normalizes on write;
-- the mapping is cached here so each raw name is only ever normalized once.
create table ingredient_aliases (
  raw_name   text primary key,          -- normalized (lowercased, trimmed) raw name
  canonical  text not null,             -- canonical ingredient name, lowercase
  created_at timestamptz not null default now()
);
create index ingredient_aliases_canonical_idx on ingredient_aliases (canonical);

-- Canonical name stored alongside the raw one on list items; merging, section
-- prefs, and (later) pantry matching key on this.
alter table grocery_items add column canonical_name text;

alter table ingredient_aliases enable row level security;
