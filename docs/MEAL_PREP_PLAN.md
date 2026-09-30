# Meal Prep & Conversational Planning — Build Plan

_Written 2026-07-20. This is the execution plan for the leftovers/meal-prep work
and, after it, conversational week-planning in Ask. When the owner says "start the
work from the markdown file," begin at **Phase 0** and proceed strictly in
order. Do not skip gates._

---

## Why this order

Both features write to `planned_meals`, share the planner prompt, and render on
the Plan page. Conversational planning built first would bake "one night = one
meal" into its prompt, schema, and preview UI — all of which batching would then
rework. Built in this order, each phase settles the ground the next stands on.

The overriding goal (the owner's words): **not cooking a full
meal every night**. Cook once on Sunday, eat several nights; the app should
understand that natively.

## Ground rules (non-negotiable, learned the hard way)

1. **One phase per deploy.** Never stack unverified phases.
2. **Gate after every phase**: my local verification passes → deploy → I verify
   production boots (login page + console clean via browser pane) → **the owner
   checks the phone checklist** → only then start the next phase.
3. **Verification includes navigation.** After exercising a feature, keep using
   the app — navigate to two other tabs. (The splash bug shipped because I
   verified the feature but not the navigation after it.)
4. **Migration before code.** Any commit that reads a new column must not be
   pushed until the owner confirms the migration ran. Code must also tolerate the
   column being absent where cheap (select errors → treat as unbatched).
5. **Dev-server hygiene**: never run `next build` while the dev server is
   running. If the dev server serves phantom errors, `rm -rf .next` + restart.
6. All UI must work in **both themes** (char/tile flip; chalk/scrim never flip)
   and at **375px and 320px** widths. Motion respects `reducedMotion="user"`.
7. Undo toasts, never confirmation dialogs (house rule).

## Current-state facts the work relies on

- `planned_meals`: one row per `(date, slot)`, slot always `'dinner'`,
  `source_type` ∈ recipe | quick_meal | freeform, `locked boolean`,
  `reason text`. No batching concept. (`supabase/migrations/001_init.sql:96`)
- `app/api/planner/route.ts` — GET week (`?start=`), POST fill-one-night.
- `app/api/planner/[id]/route.ts` — PATCH moves a night / locks / edits note
  (drag-to-rearrange already uses this); DELETE removes (optionally pulls
  grocery items, `?pull_items=1`).
- `app/api/planner/generate/route.ts` — Sonnet fills empty nights only;
  validates every pick id against real recipe/quick-meal ids; never touches
  planned nights. `PLAN_WEEK_SYSTEM` in `lib/prompts/planner.ts`.
- `app/plan/page.tsx` — week view; `PickerPortal` (`components/MealPicker.tsx`)
  fills a night; `SundayFlow` is the shopping flow; `AddToListSheet` is the
  grocery confirm step with staples matching (`lib/candidates.ts`:
  `candidatesForPlannedMeal`).
- `app/api/ask/route.ts` — Sonnet chat over `buildRecipeIndex({includeNotes})`,
  last 6 turns history. Does NOT currently see the week or quick meals.
- Scaling: `lib/scale.ts` (`scaleIngredientQuantity`) already scales recipe
  quantities by a factor — reuse for batch grocery quantities.
- Week helpers: `lib/week.ts` (`weekDates`, `toISODate`, `dayLabel`, `isToday`).

---

## Phase 0 — Pre-flight (5 min, no code)

- [ ] `git status` clean; local == origin/main.
- [ ] Production boots: load `/login` in the browser pane, console clean.
- [ ] Confirm the currently-deployed commit works on the owner's phone (they have
      presumably force-quit since the splash fix; if not, ask them to).
- [ ] Start dev server via preview (never bash), stub-verify Plan page renders.

**Owner:** nothing.

---

## Phase 1 — "Bump to tomorrow" (small, no migration)

**Purpose:** plans with an infant survive contact with reality ~60% of the
time. Amending must cost one tap or the Plan page dies in month three.

### Design

- Each filled night gets a quiet "→ tomorrow" affordance (placement: in the
  night's overflow/long-press actions if they exist; otherwise a small
  inline button matching the design language — check `app/plan/page.tsx`
  night card markup and pick the less-crammed option; header space is
  precious per the Staples lesson).
- Semantics: **move this night's meal to the next day.**
  - If tomorrow is empty → simple move (reuse existing `PATCH /api/planner/[id]`
    with the new date — the drag-rearrange path already does exactly this).
  - If tomorrow is occupied → **swap the two nights.** Predictable, no chain
    reactions, fully undoable. (Decided over "push the chain forward," which
    cascades surprises.)
  - Bumping the *last visible day* moves it into next week's Monday — allowed;
    show it in the toast ("Moved to Mon · next week").
- Undo toast restores both nights' original dates (swap back).
- `locked` nights: bumping a locked night is allowed (locking protects against
  the AI, not the human); swap partner keeps its locked flag with it.

### Files

- `app/plan/page.tsx` — the affordance + optimistic move + undo wiring.
- `app/api/planner/[id]/route.ts` — verify PATCH date-move handles the swap
  case atomically; if not, add a tiny `POST /api/planner/swap` (two ids) rather
  than two racy PATCHes. Check `unique (date, slot)` constraint: a swap via two
  updates will violate it mid-flight → do it as (A→temp date? no) — proper way:
  single RPC or: delete+reinsert in one request handler (server-side, can
  sequence: move A to a free sentinel… simplest robust: in the swap handler,
  update A to tomorrow with `upsert` semantics is blocked by the constraint, so
  sequence as: update B to a placeholder date far in the past, update A to B's
  date, update B to A's old date). Implement server-side in one handler so the
  client sees one atomic-ish call; on any step failing, restore and 500.

### My tests (browser, stubbed API where needed)

- Bump into empty tomorrow: card animates to new day; server called once;
  undo restores; navigate to Library and back (nav test).
- Bump into occupied tomorrow: both cards swap; undo restores both.
- Bump Sunday (last day of week view) → lands next week, toast says so;
  flipping to next week shows it.
- Constraint check against real behavior: no 500 from `unique(date,slot)`
  during swap (exercise the handler with curl against dev if DB creds absent —
  otherwise assert handler sequencing by code review + unit-style test of the
  ordering).
- Both themes, 375px.

### Owner's phone checklist (after deploy)

- [ ] Bump a meal into an empty day; undo it.
- [ ] Bump a meal onto an occupied day; confirm they swap; undo.
- [ ] Plan page still: add a night via picker, delete a night, drag to
      rearrange (regression).
- [ ] Navigate Plan → Library → Grocery List. No error screens.

**Gate:** all checked → Phase 2. Anything off → fix before proceeding.

---## Phase 2+3 — Batches: cook night vs reheat night, with grocery scaling

_One unit of work, one deploy. Grocery scaling ships WITH batching or the
Sunday shop under-buys — worst possible failure._

### Migration (OWNER RUNS FIRST — I must not push dependent code before they confirm)

```sql
-- 003_batches.sql
-- A batch is one cook session covering several nights. Rows sharing a
-- batch_id are one batch; the earliest date is the cook night, the rest are
-- reheat nights. nights_covered is denormalized onto every row of the batch
-- so grocery scaling never needs a second query.
alter table planned_meals add column batch_id uuid;
alter table planned_meals add column batch_nights int;
create index planned_meals_batch_idx on planned_meals (batch_id) where batch_id is not null;
```

Paste into Supabase SQL editor → run → confirm with
`select batch_id from planned_meals limit 1;` (no error = done). Tell me
"migration done" and I proceed.

Rollback if ever needed: `alter table planned_meals drop column batch_id, drop column batch_nights;`

### Design

**Creating a batch (manual in this phase — the AI does NOT create batches yet):**
- In `MealPicker`, after choosing a recipe: a "covers" row — `1 night ∘ 2 ∘ 3 ∘ 4`
  (default 1 = today's behavior, zero new friction for normal nights).
- Picking N>1 writes N rows: chosen date + the next N−1 *empty* nights
  (skip occupied nights rather than overwrite; if fewer than N−1 empty nights
  remain in view, write what fits and say so in the toast). All rows share a
  fresh `batch_id`, all get `batch_nights = N` (actual written count), same
  `recipe_id`.

**Rendering (the highest-value pixels in this feature):**
- Cook night (earliest date of batch): normal card + small badge "cooking for
  N nights".
- Reheat nights: visually lighter — the dish name + line in Smoke:
  **"already made — just reheat"**. This line is the whole feature for the
  5pm glance.
- Deleting the cook night: sheet offers "remove whole batch" vs "just this
  night" (if just this night, the next reheat becomes the cook night —
  actually: removing the cook night but keeping reheats makes no sense
  physically once cooked… decision: **deleting the cook night removes the
  whole batch, with one undo restoring all rows**; deleting a reheat night
  removes just that row and decrements nothing — `batch_nights` stays as
  originally planned for grocery history honesty). Undo restores everything.
- Bump-to-tomorrow on a batch night: moves just that row (a reheat can move
  freely; moving the cook night ahead of its reheats is nonsense — clamp: cook
  night can't be bumped past its first reheat; if attempted, bump the whole
  batch by one day instead, with the toast saying so).

**Grocery scaling:**
- `lib/candidates.ts` `candidatesForPlannedMeal`: when the meal has
  `batch_id`, scale each ingredient quantity by `batch_nights` (household
  servings factor unchanged — the multiplier is nights). Reuse
  `scaleIngredientQuantity` with factor = batch_nights, mirroring how
  RecipeDetail scales by servings.
- `AddToListSheet` shows the multiplier plainly: "Chili ×3 nights" in the
  header so the quantities aren't mysterious.
- SundayFlow's List step inherits this automatically if it goes through the
  same candidate builder — VERIFY it does (`components/SundayFlow.tsx` uses
  `AddToListSheet`; confirm the preview endpoint also scales:
  `app/api/grocery/preview/route.ts` — must use the same lib function, no
  duplicated logic).

**Types/API:**
- `lib/types.ts` `PlannedMeal` gains `batch_id: string | null`,
  `batch_nights: number | null`.
- `app/api/planner/route.ts` GET returns the new columns (it selects `*`-ish;
  verify). POST accepts `covers?: number` and does the multi-row insert
  server-side (client sends one request; server owns finding the empty nights
  — same source of truth as rendering).
- Generate route: pass batches through as locked context (existing behavior
  treats any filled night as locked — batches inherit that for free; the
  PROMPT is untouched this phase).

### My tests

- Picker with covers=3 on an empty week: 3 rows, one batch_id, cook badge on
  night 1, reheat text on 2–3.
- covers=3 with only 1 empty night following: writes 2 rows total,
  toast explains.
- Delete cook night → whole batch gone → single undo restores all 3.
- Delete a reheat → only it goes; cook night badge unchanged.
- Bump a reheat night into empty/occupied days (Phase 1 semantics hold).
- Attempt to bump cook night past first reheat → whole batch shifts one day.
- Add-to-list from a ×3 batch: quantities are 3× the single-night amounts
  (spot-check "1 lb" → "3 lb", fractional "1/2 cup" → "1 1/2 cups" via
  scale lib); staples still pre-unticked; sheet header shows ×3.
- Regression: single-night planning identical to today (covers=1 default).
- Both themes, 375px, navigation test after each flow.

### Owner's phone checklist

- [ ] Run the migration BEFORE telling me to build (I'll re-send the SQL).
- [ ] Plan a real batch (e.g., chili ×3) for the actual week.
- [ ] The two reheat nights read clearly at a glance — is "already made — just
      reheat" the right words? (Copy veto welcome.)
- [ ] Add its ingredients to the grocery list; sanity-check the quantities
      against how you'd actually shop for 3 nights.
- [ ] Delete + undo the batch. Bump a reheat night.
- [ ] Regression: plan a normal single night; Generate button still fills
      empty nights without touching the batch.

**Gate:** as before.

---

## Phase 4 — The Prep surface

**Purpose:** the Sunday cook-session view — what you're making, what each
thing covers — plus lightweight mix-and-match ("made 4 components, assemble
nights from the fridge").

### Design (deliberately modest — no new tables)

- Plan page gets two tabs at top: **Week** (default, unchanged) and **Prep**.
  (Reuse the existing chip visual language; nothing else on the page moves —
  layout-shift lesson from the grocery header applies.)
- Prep tab contents, derived entirely from existing data:
  - **Cook sessions ahead**: each batch in the visible week → card: dish,
    cook night, "covers Mon · Tue · Wed", total active time from the recipe,
    tap-through to the recipe (Cook mode already exists from there).
  - **In the fridge now**: batches whose cook night is ≤ today and which still
    have reheat nights ≥ today — dish + "made Sunday" age line. Soft state:
    a glance-and-correct list, never an inventory to maintain.
  - **Components / assemble nights**: a freeform planned meal whose title
    starts free-text is already supported (`source_type='freeform'`,
    `ingredients jsonb`). An "assemble from the fridge" night is just a
    freeform night titled e.g. "Fridge night — rice bowls"; the Prep tab has a
    one-tap "add an assemble night" that opens the existing picker's freeform
    path pre-filled. NO new component entity in this phase — we live with it
    and learn before modeling more.
- Empty state: "Nothing batched this week — plan a meal to cover several
  nights and Sunday gets easier."

### Files

- `app/plan/page.tsx` (tabs + prep view — if it gets long, extract
  `components/PrepView.tsx`).

### My tests

- Tab flip animates without layout jump; week view pixel-identical when Prep
  tab exists but is closed.
- Prep math: batch cooked "yesterday" with reheats today/tomorrow appears in
  fridge section with correct age; batch fully in the past disappears.
- Assemble-night creation lands on the chosen date, renders as freeform.
- Both themes, 375px, navigation test.

### Owner's phone checklist

- [ ] Sunday-morning read: does Prep answer "what am I cooking today and why"
      in five seconds?
- [ ] Fridge list matches reality mid-week.
- [ ] Partner test: hand someone else the phone on a reheat evening — can she tell dinner
      is already made without explanation?

---

## Phase 5 — Conversational planning in Ask

**Purpose:** negotiate the week in chat ("Thursday under 20 min, we have swim
class"; "too much chicken, swap two"), then apply picks to the Plan page with
one tap. Propose → preview → confirm — the AI never writes the week silently.

### Design

**Context** (`app/api/ask/route.ts`):
- Add to the model's input: `week` (14 days from today: date, planned title or
  null, batch info, locked), `quick_meals` index (builder exists in
  `lib/recipeIndex.ts`). Recipe index already includes notes.

**Schema** (`lib/schemas.ts` `AskSchema`):
- Add optional `plan_proposal`: `{ picks: [{ date, source_type: recipe |
  quick_meal, id, covers?: number, replaces_existing?: boolean, reason }] }`.
  `covers` creates a batch (Phase 2 semantics). Model instructed: propose ONLY
  when the user is clearly asking to plan; `replaces_existing` only when the
  user explicitly asked to change a planned night; locked nights untouchable.

**Prompt** (`ASK_SYSTEM` in `lib/prompts/cook.ts`):
- Extend with planning rules — reuse the good bones of `PLAN_WEEK_SYSTEM`
  (backlog bias, effort budget, cross-week ingredient logic, never invent ids)
  plus batch awareness ("a batch is one cook covering consecutive nights;
  lean on batches — this household prefers not to cook nightly").

**Apply step:**
- Factor the planner-generate route's validate-and-write into
  `lib/planWriter.ts` (`applyPicks(picks, {allowReplace})`): validates ids
  against real recipes/quick meals, respects `locked`, skips occupied dates
  unless `replaces_existing && allowReplace`, creates batch rows for
  `covers>1`. Generate route AND the new apply route both call it — one
  writer, two doors.
- New `POST /api/ask/apply` — body is the proposal verbatim from the chat
  message; server re-validates everything (never trust the echoed payload).

**UI** (`app/ask/page.tsx`):
- When a reply carries `plan_proposal`: render a week-card in the thread —
  each pick: day, dish, reason, batch badge if covers>1; nights it would
  replace flagged in Flame. Buttons: **Add to plan** / dismiss (dismissal =
  just keep chatting).
- After apply: success state on the card, link "See the week", and the
  proposal buttons disable (a proposal can be applied once).
- Follow-up messages naturally revise: the model sees history, can emit a new
  proposal card; old cards stay but only the newest is applyable (avoids two
  stale proposals fighting).

### My tests

- Stubbed model responses (deterministic): proposal renders; apply writes
  exactly the picks (spy on fetch); locked/occupied semantics; covers>1
  produces a batch identical to Phase 2's manual path; invalid id in a
  doctored payload is rejected server-side.
- Prose-only answers (no proposal) render exactly as today — regression.
- Generate button on Plan page still works (shared writer).
- Both themes, 375px, navigation test.

### Owner's phone checklist

- [ ] "Plan my week, Sunday should cover three nights" → sensible proposal
      with a batch → Add to plan → Plan page matches, reheat nights read
      right, grocery quantities scale.
- [ ] "Actually swap Thursday for something lighter" → revised card →
      apply replaces only Thursday.
- [ ] Ask still answers plain questions ("what should I cook tonight?")
      without shoving a plan card at you.
- [ ] Generate button regression on Plan page.

---

## Cross-cutting checklists

**Every deploy:**
1. `tsc --noEmit` clean, lint clean, `next build` succeeds (dev server
   STOPPED first).
2. Browser-pane verification per phase above, always ending with navigation
   to two other tabs.
3. Push → wait for Vercel Ready → load prod `/login` in pane, console clean.
4. Owner's checklist → gate.

**Rollback strategy per phase:** every phase is a small commit stack; revert =
`git revert` of that phase's commits (no force-push). DB columns are additive
and null-safe — old code ignores them, so a code rollback never needs a DB
rollback.

**Known environment facts** (so future-me doesn't rediscover them):
- Node 22 via `export PATH="$HOME/.nvm/versions/node/v22.17.1/bin:$PATH"`.
- Local `.env.local` has placeholder Supabase creds → API routes 500 locally;
  verify client behavior with stubbed `window.fetch` in the browser pane
  (established pattern in this repo's session history), server logic by code
  path + build.
- Never `next build` with dev server running; phantom SideMenu-style errors →
  `rm -rf .next`, restart.
- iOS PWA holds old deploys in memory; error boundaries self-heal chunk
  mismatches (one automatic reload). If the owner sees the branded error screen
  once after a deploy, that's expected; twice is a bug.

**Explicitly out of scope (decided against, don't drift into):**
- Tracked pantry inventory / portion counters (asymmetric-failure argument).
- Auto-suggesting mix-and-match combinations.
- AI-created batches anywhere except Phase 5's explicit proposals.
- New tables of any kind.

**Open items parked from earlier (not this project, don't lose):**
- `VOYAGE_API_KEY` unset in prod → search is keyword-only; embedding backfill
  needed for older recipes when set.
- `delete from extraction_cache;` if the poisoned Serious Eats entry was never
  purged (harmless to re-run).
- Library filter chips for season/effort/max-active exist in API, partially in
  UI (cuisine/tags/quick-tonight shipped; season/max-active not).
