# Multi-user (per-friend silos) — Build Plan

Goal: let a friend use the deployed app with their own data, without seeing
the owner's. The owner pays for the AI. Small scale — a few people who know each
other, not a public product.

Status: **not started.** This is the plan; no code written yet.

---

## The fact that shapes the whole approach

The server talks to Supabase with the **service-role key** (`lib/db.ts`), which
**bypasses Postgres Row Level Security**. So the textbook answer — "add
`user_id` columns and let RLS enforce isolation" — does nothing here. RLS only
applies when each request carries the user's own token, and ours never does.

**Therefore isolation is enforced in application code**: every owned-table query
gets a `.eq("user_id", …)`. The guarantee is only as strong as "did we remember
it on every query." A missed filter = one friend seeing the other's data. That
auditing is the real work, not the migration.

Decided (2026-07-20): **small scale**, so a tiny `users` table with a password
each — NOT Supabase Auth. Supabase Auth + RLS was the alternative and was
rejected as over-built for a handful of people who know each other. If this ever
needs to grow into something semi-public, revisit that decision — it's the point
where real accounts (email, magic links, per-user JWTs, RLS) become worth it.

---

## Scope (measured, not estimated)

- 30 API route files, 33 `db()` call sites.
- ~120 `.from()` calls total. Rough split of who needs the user filter:

| table | `.from()` count | needs user_id? |
|---|---|---|
| recipes | 31 | yes |
| grocery_items | 14 | yes (via trip, or denormalized) |
| captures (Storage bucket, not a table) | 12 | path-scoped by recipe id |
| staples | 11 | yes |
| planned_meals | 9 | yes |
| grocery_trips | 9 | yes |
| quick_meals | 6 | yes |
| extraction_cache | 6 | **no — keep shared** |
| pending_captures | 5 | yes (via recipe) |
| item_section_prefs | 4 | decide (personal vs shared) |
| ingredient_aliases | 4 | **no — keep shared** |
| cook_log | 2 | yes (via recipe) — but cook log is being removed, see below |
| usage | 1 | yes (so per-user spend is visible) |

~80 call sites actually need the filter. Several commits, careful auditing.

### Keep shared on purpose
`extraction_cache` and `ingredient_aliases` stay global. They're AI-cost caches
and name normalization — no personal content — and sharing them means both
users benefit from calls either already paid for. `item_section_prefs`
("hand-corrected grocery aisles") is a judgment call: personal is more correct,
shared is cheaper and lower-stakes. Lean personal unless it's annoying.

---

## Rollout (order matters — app stays working at every step)

### Phase 1 — schema, backfilled to the owner (owner runs the migration)
- New `users` table: `id`, `name`, `password`, `capture_key`. Seed the owner's row.
- Add `user_id` to owned tables **nullable**, backfill every existing row to
  the owner's id.
- Nullable + backfilled means the current app keeps working untouched — nothing
  reads the column yet.

### Phase 2 — auth carries identity (code; deploys clean, no behavior change)
- Login checks the password against `users` and sets a cookie identifying *which*
  user (not just "authed: yes"). Small evolution of `lib/auth.ts`'s existing
  shared-secret shape.
- `db()` calls unchanged; nothing filters yet. Safe halfway point.

### Phase 3 — filter every query (the big, careful commit)
- Thread the current user's id into all ~80 owned-table queries: reads filter by
  it, writes stamp it.
- This is the commit that actually creates the silos.
- **Verify by driving two accounts**, not just typecheck: log in as each of two
  test users, confirm neither sees the other's data. This is the highest-stakes
  change in the app — failure mode is a privacy leak between the two users.
- Once proven, make `user_id` `NOT NULL`.

### Phase 4 — per-user capture (code + one manual step for the friend)
- Capture route (`/api/capture`) looks up the user by the presented `x-api-key`
  instead of a single `CAPTURE_API_KEY` env var.
- Small settings screen shows each person their own capture key to copy.

---

## Manual steps (who does what)

- **Owner:** run the Phase 1 migration in Supabase, then hand-insert the
  friend's row (name + a chosen password + a generated capture key). For a
  handful of people, inserting a row by hand beats building account-management
  UI. (Build the UI only if adding people by hand gets annoying.)
- **Friend:** open the app, log in with the password the owner gave them. For the
  iOS Shortcut: take the owner's shared shortcut and change the **one**
  `x-api-key` field to their own key (shown on their settings screen). Same URL,
  everything else identical — the key is what tells the server it's them. This is
  their only fiddly step.

---

## Do the dead-code cleanup FIRST

Several features have been removed from the UI but their columns/routes are still
present and inert. Siloing them would be wasted work — don't add `user_id`
filters to routes about to be deleted. Clean up first:

- `/api/search` — uncalled since Library search was removed; needed the Voyage
  key that was never set anyway.
- `/api/recipes/[id]/cook` — uncalled since the cook log was removed.
- `/api/grocery/archive` + `/api/grocery/archive/undo`, and `archive()` in
  `lib/useGrocery.ts` — uncalled since "Done shopping" became a plain clear.
- Columns nothing writes anymore: `effort`, `status` (only ever `want_to_try`
  now), `cook_log` table. Decide whether to drop or leave.

---

## Open questions for when we pick this up
- `item_section_prefs`: per-user or shared? (lean per-user)
- Drop the dead columns/tables in the same migration as Phase 1, or separately?
- Account-management UI, or keep hand-inserting rows? (hand-insert for now)

---

## Progress & Phase 3 detail (updated 2026-07-20)

**Done and live:**
- Phase 1 — migration 004 (users table + user_id on recipes/quick_meals/
  planned_meals/grocery_trips/staples/usage, nullable, indexed). the owner seeded
  + backfilled to their row; verify returned 0 unowned rows.
- Migration 005 — unique index on users.password (login is password-only, no
  username; the server matches the typed password to a row, so passwords must
  be distinct).
- Phase 2 — auth carries identity. Login checks password against users; cookie
  is "<id>.<sha256(recipe-app-v2:id:APP_PASSWORD)>", validated on the Edge with
  no DB call. APP_PASSWORD is now the signing secret, not a login password.
- Dead-code deletion: /api/search and /api/backlog + BacklogStrip.tsx removed
  (truly unreferenced). NOT deleted — /api/recipes/[id]/cook (Cook Mode still
  logs completions) and /api/grocery/archive + undo (SundayFlow still calls
  them); both get SILOED, not deleted.

**Seed gotcha to remember:** the seed snippet's placeholders can get inserted
literally — the owner's row had password='YOUR_CURRENT_PASSWORD' verbatim and
login rejected them. Fix was an UPDATE with real values. Tell whoever runs it to
substitute the placeholders.

**Phase 3 — the query threading (NOT started; this is the next focused pass).**
Approach that worked: make the shared helpers take a REQUIRED userId so the
compiler forces every caller to thread it — the one part that can be
compiler-enforced (buildRecipeIndex, buildQuickMealIndex, getOrCreateOpenTrip,
addItemsToOpenTrip). Everything else is a manual audit; TypeScript can't catch
a missing `.eq("user_id", uid)`.

Subtleties uncovered that expand the naive plan:
- **Ownership checks, not just list filters.** Any route acting on a resource
  by id (PATCH/DELETE /recipes/[id], grocery item edits, planner slot ops) must
  add `.eq("user_id", uid)` so it 404s rather than mutating someone else's row.
- **grocery_items needs its OWN user_id** (denormalize). Several grocery ops go
  by item id or source_id and can't cleanly scope through the parent trip.
  Add user_id to grocery_items + backfill from trips in the Phase 3 migration,
  then every grocery_items query filters uniformly.
- **lib/candidates.ts** reads recipes/planned_meals by id and all staples —
  candidatesForRecipe / candidatesForPlannedMeal / annotateOwned all need a
  userId param + ownership filter.
- **Capture-key resolution folds into Phase 3** (it was Phase 4's core): the
  capture route must resolve the owner from the presented x-api-key against
  users.capture_key and stamp user_id on the inserted recipe + pass it to
  runExtraction. checkDuplicate inside runExtraction must scope to that user.
  Drop the single-key env check for capture; per-user keys replace it. (Phase 4
  then is just a settings screen showing each person their key.)
- **Leave shared:** resolveItems' cross-user grocery_items read is section
  inference only ("milk → dairy"), no private data — treat like the already-
  shared alias/section caches. Also extraction_cache, ingredient_aliases,
  item_section_prefs stay shared.

Phase 3 migration (owner runs, at the END once filtering is verified):
- add user_id to grocery_items + backfill from parent trip.
- drop the global `one_open_trip` unique index; add per-user
  `unique (user_id) where status='open'`. (Do this WITH the user-aware
  getOrCreateOpenTrip so there's never a two-open-trips window.)
- make user_id NOT NULL on the owned tables (after backfilling any interim
  orphans created between Phase 2 and 3 — only the owner exists, so re-run the
  Phase 1 backfill sweep first).

Full route list to thread (~22): recipes (route, [id], [id]/image, [id]/retry,
[id]/cook, manual, status, backfill-course), capture, grocery (trip, clear,
items, items/[id], preview, archive, archive/undo), planner (route, [id],
generate), staples (route, [id]), quick-meals, pantry, ask, invent (route,
recipe), export. Plus lib: recipeIndex, grocery, candidates, extract
(runExtraction + checkDuplicate).

**Acceptance test (owner runs — I can't, login-gated + needs 2 accounts):**
create a throwaway 2nd user, log in as each, confirm neither sees the other's
recipes / grocery list / staples / plan. Gate before real friends are added.
