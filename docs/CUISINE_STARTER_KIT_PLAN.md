# Explore a Cuisine — Staples Starter Kit

**Status:** Spec / not started. Written 2026-07-23. Work on it later.

## One-liner

Help someone get into cooking a cuisine (French, Thai, …) by seeding their
kitchen with that cuisine's staple ingredients — routed through the grocery
list they already use, and promoted to real staples only once they've actually
bought them.

## Why

A cuisine isn't unlocked by recipes, it's unlocked by what's in your kitchen.
You can't "Wing it" French without shallots, dijon, thyme, butter, white wine,
crème fraîche on hand. Seeding staples is what turns "I want to cook more
French" into a kitchen that can actually do it. It compounds with the rest of
the app: seed French staples → Wing it's cuisine steer has something to work
with (Wing it only suggests what you already have) → French recipes stop showing
big "you're missing X" gaps.

## Core mechanic (decided)

1. User opens **"Explore a cuisine"** on the Staples page.
2. Short flow: **cuisine → focus → depth** (see below).
3. A model generates a **reviewable checklist** of that cuisine's staples, each
   tagged with a grocery **section**, a **shelf-life class**, and a one-line
   **why**. Deduped against staples they already keep.
4. User unchecks anything they don't want, confirms.
5. Items land on their **grocery list**, each with a **"French Staples"** style
   subtext (the cuisine + "Staples").
6. When the user **checks an item off** in the grocery list (i.e. they've bought
   it), that item is **promoted to a staple** — with a restock **cadence set by
   its shelf-life class**.
7. The kit is a **named group** ("French Staples") so it can be **retired as a
   set** later.

Only items seeded by this feature get the promote-on-check behavior. Normal
grocery items are untouched.

### The flow's three questions

- **Cuisine** — reuse the Wing it preset list (`CUISINES` in
  `app/pantry/page.tsx:47`), plus a free-text option. Add `"French"` to that
  shared list.
- **Focus** — Everyday meals / Baking / Desserts / A bit of everything. This is
  the important cut: French savory (aromatics, wine, stock, mustard, herbs,
  gruyère) and French baking/pastry (00 flour, butter, yeast, vanilla,
  chocolate) barely overlap. Without this the list is half-wrong.
- **Depth** — Essentials (~8 items) / Full kit (~20). Keeps it from burying the
  staples list.

## Perishables — the shelf-life approach (decided)

The app already models perishability: staples have a restock rhythm
(`typical_cadence_days`, "due", "overdue"). That *is* shelf life.

- Shelf-stable (rice, dijon, flour, vinegar, oils) → **long cadence** (restock
  every few months). Real "always keep in" items.
- Perishable (crème fraîche, butter, shallots, gruyère) → **short cadence**
  (~7–14 days).

So the generator tags each item's **shelf-life class**, and that tag sets
`typical_cadence_days` when the item promotes to a staple. The existing
due/overdue system then becomes *honest*: crème fraîche shows "due again" ~2
weeks later, which is correct if you're cooking the cuisine regularly.

**Decision:** promote *everything* to staples on check (so Wing it knows you've
got the perishables this week), but:

- Tag perishables clearly ("fresh") so it's obvious which ones will expire.
- Make the kit **retirable as a group** so a cuisine you've moved on from
  doesn't leave short-cadence perishables nagging as permanently "overdue".

### Shelf-life → cadence mapping (starting point, tune later)

| Class        | Examples                                   | `typical_cadence_days` |
| ------------ | ------------------------------------------ | ---------------------- |
| `pantry`     | dijon, flour, vinegar, oil, dried herbs    | ~120                   |
| `slow_fresh` | hard cheese, cured items, root veg         | ~30                    |
| `fresh`      | crème fraîche, butter, soft herbs, shallots| ~10                    |

## Companion: Wing it cuisine button (trivial)

The cuisine steer already exists end-to-end in Wing it. Adding **"French"** is a
one-word edit to the `CUISINES` array at `app/pantry/page.tsx:47`; the chip row
(`:595-610`) renders it automatically, `invent()` (`:341`) already passes
`cuisine` to `/api/invent`, and `INVENT_PITCHES_SYSTEM` already honors it. Do
this first as a quick win.

---

# Build plan

Ordered so each step is shippable/testable on its own.

### Step 0 — Wing it "French" preset (5 min)

- Add `"French"` to `CUISINES` in `app/pantry/page.tsx:47`. Done.

### Step 1 — Data: mark grocery items & staples as kit members

Grocery items already carry arbitrary metadata via the `sources` jsonb array
(`lib/grocery.ts:189-194`), so **no new `source_type` enum value is strictly
required** — but the promote-on-check logic and the "retire as a group" feature
both need a durable, queryable tag. Two options:

- **Option A (preferred): new `grocery_source_type` enum value `'cuisine_seed'`
  + a `kit` label.** Requires a migration (`ALTER TYPE grocery_source_type ADD
  VALUE IF NOT EXISTS 'cuisine_seed';` — keep it isolated; `ADD VALUE` can't run
  in a txn block with other statements). Store the cuisine name + shelf-life
  class in the item's `sources` entry (`{type:'cuisine_seed', label:'French',
  quantity:'', shelfLife:'fresh'}`) — `sources` is free-form jsonb.
- **Option B (no migration): tag purely inside `sources` jsonb.** Detect kit
  items by scanning `sources` for a `cuisine_seed` entry. Weaker to query but
  zero schema change.

Staples side: to retire a kit as a group and to know a staple's cuisine origin,
add a nullable `kit` (text) column to `staples` (migration `009_*.sql`,
`add column if not exists kit text;`). Set it when promoting. Null for
hand-added staples. Also consider adding a `(user_id, lower(name))` **unique
index** to fix the existing no-dedupe gap (see Step 4).

**Migration file:** `supabase/migrations/009_cuisine_kits.sql` following the
house style (leading why-comment, `if not exists` idempotency, pasted into the
Supabase SQL editor by hand). If using Option A, the `ALTER TYPE` goes in its
own file or is run first, separate from the column adds.

### Step 2 — Generator: model call for cuisine staples

- **Prompt** `CUISINE_STAPLES_SYSTEM` in `lib/prompts/cook.ts`. Inputs: cuisine,
  focus, depth, and the user's existing staple names (for dedupe context).
  Output rules: return the cuisine's backbone staples for that focus/depth;
  each item gets a grocery `section` (one of `GROCERY_SECTIONS`), a
  `shelf_life` class (`pantry` | `slow_fresh` | `fresh`), and a one-line `why`.
  Don't repeat items the user already keeps. Cap counts by depth.
- **Schema** `CuisineStaplesSchema` in `lib/schemas.ts`:
  ```ts
  z.object({
    items: z.array(z.object({
      name: z.string(),
      section: z.enum(GROCERY_SECTIONS).default("other"),
      shelf_life: z.enum(["pantry","slow_fresh","fresh"]).default("pantry"),
      why: z.string().default(""),
    })).default([]),
  })
  ```
  (Mirror `CategorizeSchema`'s `z.enum(GROCERY_SECTIONS)` usage,
  `lib/schemas.ts:43-51`.)
- **Route** `app/api/cuisine-staples/route.ts` (`POST`): auth via
  `currentUserId`; body `{ cuisine, focus, depth }`; load existing staple names;
  call `askJson({ feature:"cuisine-staples", model: MODELS.smart, system:
  CUISINE_STAPLES_SYSTEM, content: JSON.stringify({cuisine, focus, depth,
  existing}), schema: CuisineStaplesSchema, maxTokens: 1200, effort:"low" })`;
  return the items. (Mirror `/api/invent`, `app/api/invent/route.ts:38-55`.)
  This route only *generates* — it doesn't write anything yet.

### Step 3 — UI: the "Explore a cuisine" flow on the Staples page

- **Entry card** near the top of `app/staples/page.tsx` — slot it after the
  header `<p>` (~`:104`) or after the add-row (~`:127`), before the `<ul>` at
  `:135`. Styled like other cards ("Explore a cuisine →").
- **Sheet/flow component** `components/CuisineKitSheet.tsx`:
  - Step A: pick cuisine (shared `CUISINES` list + free text).
  - Step B: pick focus (4 chips). Step C: pick depth (2 chips).
  - Calls `POST /api/cuisine-staples`, shows the returned **checklist** (name,
    section pill, `why` subtext, a "fresh" tag for perishables), all checked by
    default; user unchecks.
  - Confirm → `POST /api/grocery/items` with `full_items` (or a new small
    endpoint) carrying each item's name, section, and a `cuisine_seed` source
    entry (`{type:'cuisine_seed', label:'<Cuisine> Staples', shelfLife}`) so the
    grocery list shows the subtext and the promote-on-check hook can fire.
  - After write, dispatch `window.dispatchEvent(new CustomEvent("grocery-changed"))`
    (required to refresh the local-first grocery cache — see
    `useGrocery.ts:254`).
- **Grocery row subtext:** the grocery Row already reads `item.sources`
  (`app/grocery/page.tsx:316`); render "<Cuisine> Staples" when a `cuisine_seed`
  source is present.

### Step 4 — Promote-on-check: grocery → staple

- **Hook point (server, preferred):** in the grocery item PATCH handler
  `app/api/grocery/items/[id]/route.ts:33-51`, after a successful update where
  `body.checked === true`, inspect the updated `item`. If it carries a
  `cuisine_seed` source, **upsert a staple**: name, section, `kit = '<Cuisine>'`,
  and `typical_cadence_days` from the shelf-life → cadence table above, with
  `last_added = today` (they just acquired it). Do it after the response is sent
  (mirror the `after(() => updateEmbedding(id))` pattern used elsewhere) so the
  toggle stays snappy.
- **Dedupe:** the staples POST has no dedupe and there's no DB constraint
  (`app/api/staples/route.ts:45-67`). Add an existence check (by
  `user_id` + lower(name)) before insert — or add the unique index from Step 1
  and upsert. Without this, re-buying a kit item makes duplicate staples.
- **Un-check:** decide whether un-checking a promoted item should demote the
  staple. Recommendation: **no** — once stocked, it's a staple; leave it. Keep
  the logic one-directional to avoid surprises.

### Step 5 — Retire a kit as a group

- Staples page: when any `kit`-tagged staples exist, offer "Remove French
  Staples" (a grouped action). Implement as a bulk `PATCH {active:false}` (the
  retire path, `app/api/staples/[id]/route.ts:8-33`) or DELETE (the UI's current
  remove path, `staples/page.tsx:67`) across all staples with that `kit`.
  Prefer deactivate (`active:false`) so history isn't lost, but match whatever
  the rest of the staples UI does for consistency.

---

## Open questions / decisions still to make

- **New enum value vs jsonb-only tag** (Step 1, Option A vs B). A/B tradeoff is
  migration cost vs queryability. Leaning A.
- **Un-check demotes?** Recommended no.
- **Where the grocery items are created** — reuse `POST /api/grocery/items`
  `full_items` path, or a dedicated `/api/cuisine-staples/add` that also stamps
  the seed metadata cleanly. Leaning a dedicated add endpoint so the seed
  metadata and the "<Cuisine> Staples" label are set server-side in one place.
- **Model quality per cuisine** — generation is the right default (one build,
  any cuisine); hand-tune a top cuisine's list later only if it comes out weak.
- **Cadence numbers** — the table above is a starting point; tune against real
  use.

## Key file references (as of writing)

- Staples table: `supabase/migrations/001_init.sql:148-156`; `Staple` type
  `lib/types.ts:57-66`.
- Staples API: `app/api/staples/route.ts` (POST `:45-67`, GET `:11-43`, PUT
  restock `:73-99`), `app/api/staples/[id]/route.ts` (PATCH/DELETE).
- Staples page: `app/staples/page.tsx` (top `:99-133`, list `:135-177`).
- Grocery items table: `supabase/migrations/001_init.sql:129-141`; enum
  `grocery_source_type` `:22`. `GroceryItem` type `lib/types.ts:117-130`.
- Grocery add: `app/api/grocery/items/route.ts` POST; `addItemsToOpenTrip` /
  `NewItem` `lib/grocery.ts:156-233`.
- Check-off: client `lib/useGrocery.ts:331-341` (`toggle`) → sync
  `:158-175` → server `app/api/grocery/items/[id]/route.ts:15-52`.
- Sections: `lib/config.ts:30-52` (`GROCERY_SECTIONS`, `SECTION_LABELS`).
- Wing it cuisine steer: `app/pantry/page.tsx:47` (`CUISINES`), `:595-610`
  (chips), `:341-350` (`invent`), `/api/invent` `route.ts:28,47`,
  `INVENT_PITCHES_SYSTEM` `lib/prompts/cook.ts`.
- Model pattern: `askJson` `lib/anthropic.ts`, `MODELS` `lib/config.ts:3-8`,
  example route `/api/invent` `app/api/invent/route.ts:38-55`.
- Migrations: latest `supabase/migrations/008_planned_meal_time.sql`; next is
  `009_*.sql`. `grocery-changed` event refreshes grocery cache
  (`lib/useGrocery.ts:254`).
