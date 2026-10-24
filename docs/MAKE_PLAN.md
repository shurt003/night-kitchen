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

## No migration needed

`tags`, `source_name` and `servings` already exist. "make" is just a tag.

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
- [ ] Principles split; Wing it's prompt byte-identical (assert in a quick
      script before committing).
- [ ] `MAKE_SCOPE_SYSTEM` + `/api/make/scope`; servings chips when needed;
      standard yields shown when not.
- [ ] `MAKE_RECIPE_SYSTEM` + `/api/make/recipe`; drafts in `RecipeDetail`;
      Save / Save all; Add missing to list.
- **Phone checklist:**
  - "chicken tikka masala" asks for servings, and the recipe has temps + cues.
  - "brownies" doesn't ask, shows the pan yield, and uses dessert rules
    (weights, doneness cue).
  - "dinner for 6: short ribs, a side, a dessert" doesn't ask, gives 3 dishes
    plus a game plan, and "Add all" creates no duplicate grocery items.
  - Save one; find it in the Library tagged as generated.
  - Wing it still works exactly the same.

### Phase 3: Polish
- [ ] Loading copy and motion consistent with Wing it; Stop/cancel on long
      generations; errors that say what to do next.
- **Phone checklist:** airplane mode mid-request shows a clear error;
      everything else still navigates normally afterward.

## Cost

One fast scope call (fractions of a cent) plus one Sonnet 5 generation per
request. At a few requests a week, well under a dollar a month.
