-- Course classification for library filtering: Breakfast / Appetizers /
-- Dinners / Sides / Desserts, plus "other" for anything that fits none
-- (drinks, sauces, snacks). The pills filter on this; "All" ignores it.
--
-- Plain text, not an enum, so the course list can change later without another
-- migration. The controlled vocabulary lives in the app (extraction prompt +
-- schema), not the database.
--
-- Nullable and unbackfilled here on purpose: existing rows stay null until the
-- one-time classify pass runs, and null reads as "uncategorized" — shown only
-- under All, never dropped.

-- if-not-exists so a retry is safe: the Supabase editor can fail at the network
-- layer after the statement already applied server-side, leaving it ambiguous
-- whether it ran.
alter table recipes add column if not exists course text;

-- Small library, but the filter hits this on every pill tap.
create index if not exists recipes_course_idx on recipes (course);
