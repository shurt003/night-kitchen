# Make — Build Plan

_Written 2026-10-24. Status: **Phase 0 done; Phase 1 next.** Go strictly in
order; each phase ends at a gate._

## One-liner

A new **Make** page: say what you want ("chicken tikka masala", "date night:
steak, a side and a dessert") and get a full recipe, or a whole meal, to cook,
written with the same cooking principles as Wing it.

## How it differs from Wing it (keep them separate, per the owner)

| | Wing it | Make |
|---|---|---|
| Starts from | What's in the kitchen right now | What you *want* to eat |
| Shopping | Never. Cookable tonight from on-hand + staples | Allowed. Missing items go to the grocery list |
| Output | 3 pitches, then one recipe | One recipe, or a whole meal (2–4 dishes) |
| Servings | Fixed default | Asked each time, unless the dish has a standard batch size |

Wing it's prompts and behavior must not change. Its composed prompt must stay
**byte-identical** (checked with a string comparison).

## Decisions so far

- **Generate only. No outside search.** Phase 0 proved Serious Eats can't be
  searched by Claude (details below), and the owner chose not to search
  anywhere else or check the library first.
- **The cooking principles apply to every Make recipe** (Salt Fat Acid Heat /
  The Food Lab sensibility, in our own words).
- **Servings:** ask each time, unless the dish has a standard yield (meatloaf,
  brownies, a loaf of bread, a batch of cookies, a pan of lasagna). A number
  in the request ("for 6") counts as an answer.
- The plan doc is committed together with Phase 1.

## Nav change

- Bottom bar: **Library · Make · Wing it · Grocery List** (Make replaces Plan).
- Plan stays in the side menu, where it already is. Add **Make** to the side
  menu too, with the hint "Tell it what you want."
- Tabs are sized to their labels (`components/Nav.tsx`). Check the active pill
  still centers.

## The user flow

1. **Ask.** A text box with examples cycling in the placeholder. A "Whole
   meal" toggle (also detected from the request: "dinner for…", "a main and
   a side"). Optional max active time (reuse Wing it's control).
2. **Servings check** (fast, about a second): a quick call decides whether the
   request names servings, has a standard yield, or needs asking. If it needs
   asking, show servings chips inline (1 · 2 · 4 · 6 · 8 · other) and wait.
   Otherwise go straight on, and show the yield it chose ("Makes one 9×13
   pan, about 16 brownies").
3. **Generate.** The recipe opens in the existing `RecipeDetail` as a
   **draft** (`draft` + `onSave` already exist). Staples are marked "you have
   this." **Save** goes through `/api/recipes/manual` (tagged `generated` +
   `make`). **Add missing to list** reuses the grocery add path.
4. **Whole meal:** 2–4 dishes plus a short **game plan** (what to start first
   so everything finishes together). Each dish is its own draft. "Save all"
   saves them together. "Add all missing to list" uses one trip (grocery
   merging already de-duplicates).

## Cooking principles (`lib/prompts/cook.ts`)

Today `COOKING_PRINCIPLES` is one block written for Wing it. Split it into
named pieces and **re-compose Wing it's block from them byte-identically**:

- **Shared core:** season in stages / taste as you go; balance salt, fat, acid,
  heat; acid with judgement; fat on purpose; browning; deliberate heat; build
  flavor as you go; contrast.
- **Savory-only:** doneness by cue + USDA internal temps; rest meat and
  carryover.
- **Wing it-only:** "using what's in the kitchen, not a long shopping list";
  "put their seasoning shelf to work"; "tonight's dinner, never a long brine."
- **New: desserts and baking** (Food Lab is mostly savory, so this is general
  baking science in our own words, not attributed to either book):
  - weigh where precision matters (grams alongside cups)
  - exact oven temps and preheating
  - butter temperature on purpose (cold for flaky, softened for creamed,
    browned for nutty)
  - salt in sweets to sharpen them; acid to brighten (zest, buttermilk) and
    how it feeds baking soda
  - real browning (toast nuts, caramelize sugar, brown butter)
  - don't overmix once flour is in
  - doneness by cue (toothpick, jiggle, set edges, internal temp for breads
    and custards)
  - carryover and setting as it cools

Make's prompt includes the core plus **both** savory and dessert sections,
with the instruction to apply the section that fits each dish. That way a
whole meal with a dessert gets the right rules for every dish without an
extra call. Make does **not** get the Wing it-only lines: shopping is
allowed, and a dish can call for an overnight brine if the cook has time.

New prompts:
- `MAKE_SCOPE_SYSTEM` (fast model): `{ kind: "dish"|"meal",
  servings_in_request: number|null, standard_yield: string|null,
  needs_servings: boolean, dishes: [{title, course}] }`.
- `MAKE_RECIPE_SYSTEM` (smart model): the full recipe, or meal + game plan,
  as `ExtractionSchema` objects, using staples where they fit. Missing items
  are fine; they're flagged for the grocery list.

## API routes (new)

- `POST /api/make/scope` → the scope JSON above (`MODELS.fast`, low effort).
- `POST /api/make/recipe` → `{ dishes: Extraction[], gamePlan?: string[] }`
  (`MODELS.smart`). Nothing is written; drafts live in client state until
  saved (same as `/api/invent/recipe`).
- Both: `currentUserId` check, `maxDuration` 120, usage logged via `askJson`
  with features `make_scope` / `make_recipe`.

## Migrations

Phases 1–2 needed none (`tags`, `source_name` and `servings` already exist;
"make" is just a tag). Phase 2.5b adds `011_saved_meals.sql`.

## Phases and gates

Each gate means: my local verification passes (typecheck plus the page in the
browser preview), then deploy, then I check production boots, then **the owner
runs the phone checklist**, and only then the next phase. After testing a
feature, keep using the app and navigate to two other tabs (the splash-bug
rule).

### Phase 0: Serious Eats search spike: DONE 2026-10-24, result: NOT POSSIBLE
- `allowed_domains: ["seriouseats.com"]` is rejected with a 400: "The
  following domains are not accessible to our user agent". Serious Eats
  blocks Anthropic's crawler.
- An unrestricted search for "serious eats chicken tikka masala" returned
  **no** seriouseats.com URLs, only reposted copies on aggregator sites.
- One search ≈ 39k input tokens (~8¢ on Sonnet 5).
- Decision: no outside search in Make. No workaround to be attempted.

### Phase 1: Nav + empty Make page
- [ ] Bottom bar becomes Library · Make · Wing it · Grocery List; Make added to
      the side menu; Plan still reachable from the side menu.
- [ ] `/make` page with the input, Whole meal toggle and empty state, in
      Night Kitchen style (DESIGN.md). The submit button can be a stub.
- [ ] Commit this plan doc with Phase 1.
- **Phone checklist:** the new tab order; the active pill animates and centers
      on every tab; Plan opens from the side menu; Wing it unchanged.

### Phase 2: Generate (single dish + whole meal)
- [x] Principles split; every existing prompt export verified byte-identical
      against the previous commit (transpile + string compare).
- [x] `MAKE_SCOPE_SYSTEM` + `/api/make/scope`; servings chips when needed;
      standard yields shown when not.
- [x] `MAKE_RECIPE_SYSTEM` + `/api/make/recipe`; drafts in `RecipeDetail`;
      Save / Save all; a meal adds to the list in one confirm step
      (`recipe_ids` added to the grocery preview/items routes). A single
      dish adds from its own sheet after saving, as any saved recipe does.
- [x] Prompt test against the live model (2026-10-24): "chicken tikka
      masala" asked for servings (1.3s scope, 24s write); "brownies" used
      "one 9×13 pan, about 16 brownies" with grams + doneness cues (17s);
      "dinner for 6: short ribs, a side, and a dessert" gave 3 dishes + a
      7-step game plan (53s).
- [x] Gate feedback (owner, 2026-10-24): brownies showed no grams. Cause: the
      recipe view renders quantity + unit + item and never `raw`, so grams
      written into `raw` were invisible. Fix: an optional `grams` field on
      ingredients (`IngredientSchema`), shown as "1¼ tsp (4 g) kosher salt"
      and scaled with servings in `RecipeDetail` (plus cook mode). Make's
      baking lines require it on every ingredient except whole eggs, with
      kosher salt weights assuming Diamond Crystal. Re-tested brownies and
      cookies: every measured line had grams.
- **Phone checklist:**
  - "chicken tikka masala" asks for servings, and the recipe has temps + cues.
  - "brownies" doesn't ask, shows the pan yield, and uses dessert rules
    (weights, doneness cue).
  - "dinner for 6: short ribs, a side, a dessert" doesn't ask, gives 3 dishes
    plus a game plan, and "Add all" creates no duplicate grocery items.
  - Save one; find it in the Library tagged as generated.
  - Wing it still works exactly the same.

### Phase 2.5: Meals that stay together (owner's request, 2026-10-24)

Today "Save all" saves each dish as its own recipe and the game plan lives
only in the Make page's 12-hour session, so it's lost. The owner wants a full
meal kept together, viewable like the Make page, plus two extras. Decisions:

- The course pill **"Meals" is relabelled "Mains"** (label only; the stored
  value stays `meals`).
- **A "Meals" toggle pill** in the Library filter row (after "All"). Off by
  default: the Library looks as it does today, with every dish its own tile.
  On: only saved full meals.
- **"What time is dinner?"** is optional, offered once a meal is written. It
  turns the game plan's relative timings into clock times.
- **Swap one dish** ("give me a different side") rewrites that dish and the
  game plan.

#### 2.5a: Structured game plan, dinner time, swap a dish (no migration)
- [x] `MAKE_RECIPE_SYSTEM` returns `game_plan` as
      `[{ offset_min, label, text }]`, where `offset_min` is minutes before
      serving (null for "to serve"). Old string plans in a stored session
      still render (parsed, or shown as-is).
- [x] "What time is dinner?" under the game plan: a native time picker. Set:
      each step shows its clock time ("3:00 pm") in place of "4 hours
      before". Clear it to go back. Pure client math, no model call.
- [x] "Swap" on each dish of a meal: an optional hint ("something lighter",
      "no oven", free text) → `POST /api/make/swap` rewrites that one dish
      in light of the others and returns a fresh game plan. A swapped dish is
      a new draft; if the old one was already saved it stays in the Library
      (nothing is deleted on a swap).
- Built 2026-10-24. Steps a day or more ahead keep their words ("The day
  before") rather than a false clock time. Live test: dinner for 6 came back
  structured (300 min = "5 hours before"); swapping the mashed potatoes with
  "something lighter" gave a fennel and arugula salad in 32s, with a plan that
  no longer mentions potatoes. `GamePlan` and `MealDishList` are components so
  the saved-meal sheet in 2.5b reuses them.
- **Phone checklist:** make a meal; set dinner for 7:00 and check the times
  read right (and that a step "4 hours before" says 3:00 pm); clear it; swap
  the side with "something lighter" and check the game plan mentions the new
  side and not the old one.

#### 2.5b: Saved meals in the Library (migrations `011` + `012`)
- [x] 2.5a shipped (a9d9a50). The owner also dropped the One dish / Whole
      meal pills: the scope read takes it from the words.
- [x] `011_saved_meals.sql` and `012_saved_meals_nights.sql` run by the owner 2026-10-24.
- [ ] **`012_saved_meals_nights.sql`** (owner runs before any 2.5b code is
      pushed): makes saved meals multi-night-ready for 2.6 while the tables
      are still empty. Adds `kind` ('meal' | 'nights'), `nights` (per-night
      label + game plan); dishes get their own `id`, a `night` and a `note`,
      so one recipe can sit on two nights (cook once, eat twice). 2.5b itself
      only ever writes `kind = 'meal'`, night 1.
- [x] Every saved meal has a **name**: suggested when saved ("Short rib
      dinner"), tap to rename, in the Make results and the meal sheet.
- [ ] **Migration first:** the owner runs `011_saved_meals.sql` in Supabase
      before any code that reads it is pushed. It adds `saved_meals` (title,
      request, servings, game plan, serve_time) and `saved_meal_dishes`
      (ordered recipe ids; deleting a recipe drops it from its meal).
- [x] "Save all" on a meal also saves the meal. Re-saving after a swap
      updates the same meal rather than creating a second.
- [x] Library: "Mains" relabel; "Meals" toggle pill showing meal cards only.
      The meal card shows the title, dish names, "3 dishes · serves 6", and
      the main's photo once it has one.
- [x] Meal sheet: same layout as the Make results (game plan with dinner
      time, dish cards → normal recipe sheet), plus "Add everything to
      grocery list" and "Swap" on each dish.
- [x] A recipe that belongs to a meal shows "Part of: <meal>" linking back.
- [x] Deleting a meal opens a **confirmation sheet that animates up** (the
      owner's call; the one place a confirm is used instead of only an undo,
      because the choice matters) with two options: **"Delete the meal, keep
      the recipes"** and **"Delete the meal and its N recipes"**, plus Cancel.
      Either one then shows the usual undo toast. Deletion is **deferred**,
      like the Library's recipe delete: everything is hidden at once but
      nothing is removed server-side until the toast's window closes, so undo
      is lossless (recipes, photos, cook logs). If the app is closed inside
      the window, nothing is deleted (the safe direction).
- Built 2026-10-24, verified by typecheck, build and a visual check only:
  the meals routes need the database, which isn't reachable locally, so the
  phone checklist is the first real run. Swapping inside a saved meal saves
  the new dish straight away and updates the meal; the old recipe stays.
- **Phone checklist:** save a meal; toggle Meals on in the Library and open
  it; the game plan and dinner time are there; open a dish and follow its
  "Part of" link back; delete the meal choosing "keep the recipes" and check
  the three recipes are still there, then undo; delete it again choosing
  "and its recipes", check all are gone, then undo and check everything is
  back, photos included.

### Phase 2.6: Multi-night plans (owner's idea, 2026-10-24)

"Dinners for the next 5 nights for two", "cook once on Sunday, eat three
nights", "short ribs that work for two nights". The owner said to treat the
Plan page as if it doesn't exist for this: it lives entirely in Make and
saves under the Library's "Meals" toggle (name kept as "Meals"). To be
planned in detail before building; the shape so far:

- **Outline first, recipes second.** A quick outline (~20s): one line per
  night (dish, or "leftover ribs → ragu over pappardelle"), a shared prep
  session ("Sunday, 90 min: braise the ribs, cook the rice, make the sauce"),
  and ingredient overlap ("one bunch of cilantro covers Mon and Thu"). Swap
  any night here, cheaply, before anything is written. Then **"Write it
  all"** writes every recipe in parallel (~30s total, not 3+ min in one call
  that could hit the time limit).
- **Cook once, eat twice:** the cook is scaled to cover both nights; night two
  is the dish reheated or remixed, with storage and reheating notes.
- **One grocery list** for the whole stretch, de-duplicated.
- **Named** like every saved meal; the Library card reads "5 nights · 7
  recipes".
- Storage is ready from `012` (`kind = 'nights'`, per-night rows).
- **Open idea (owner, 2026-10-24, to revisit):** write recipes only when a
  night is tapped, like Wing it, instead of "Write it all" up front. Agreed
  shape if adopted: the outline carries each night's ingredients and a
  combined shopping list (so one shop works before any recipe exists); a
  night's recipe is written against the outline's ingredients and prep plan
  as constraints; written nights are kept; a "Write all" button for prep
  day; unwritten nights save as cards. Main win is speed (a recipe costs
  ~2–3¢, a week ~10–15¢ up front).

### Phase 3: Polish
- [ ] Loading copy and motion consistent with Wing it; Stop/cancel on long
      generations; errors that say what to do next.
- **Phone checklist:** airplane mode mid-request shows a clear error;
      everything else still navigates normally afterward.

## Cost

One fast scope call (fractions of a cent) plus one Sonnet 5 generation per
request. At a few requests a week, well under a dollar a month.
