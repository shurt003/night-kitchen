"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { Recipe } from "@/lib/types";
import type { Extraction, MakeScope } from "@/lib/schemas";
import { springSoft, springUI } from "@/lib/springs";
import { RecipeDetail } from "@/components/RecipeDetail";
import { GamePlan } from "@/components/GamePlan";
import { EditableTitle } from "@/components/EditableTitle";
import { MealDishList, MEAL_ROLE } from "@/components/MealDishList";
import { normalizeGamePlan, type GamePlanStep } from "@/lib/gamePlan";
import { AddToListSheet } from "@/components/AddToListSheet";
import { Spinner } from "@/components/Spinner";
import { CyclingLine } from "@/components/CyclingLine";
import { draftRecipe } from "@/lib/draftRecipe";
import { MAKE_SESSION_KEY } from "@/lib/userCache";
import { MakeWeek } from "@/components/MakeWeek";

/**
 * Make: ask for a dish (or a whole meal) and get a recipe written for it.
 * Unlike Wing it, shopping is allowed — whatever's missing goes to the list.
 * See docs/MAKE_PLAN.md.
 *
 * Two calls: a quick scope read (one dish or a meal, and whether servings need
 * asking), then the write. Servings are asked every time unless the request
 * says or the dish has a natural batch size — the owner's call.
 */

/**
 * Rotated through the empty box so the range of what you can ask for is
 * shown rather than explained. A one-dish ask, a whole-meal ask, a dessert —
 * the three shapes Make answers.
 */
/** What "Plan the week" can be asked — the rest is chosen with the chips. */
const WEEK_EXAMPLES = [
  "mix and match dinners, with a big tray of roasted veg to use all week",
  "quick weeknight dinners, nothing over 30 minutes",
  "cook once on Sunday, eat well all week",
  "lots of vegetables, a couple of fish nights",
];

const EXAMPLES = [
  "chicken tikka masala",
  "date night: steak, a side and a dessert",
  "brown butter chocolate chip cookies",
  "something cozy with short ribs",
  "a big pot of chili for the weekend",
];

/** Same caps as Wing it — active time is what decides whether a night works. */
const TIMES: { label: string; max: number | null }[] = [
  { label: "Any time", max: null },
  { label: "30m or less", max: 30 },
  { label: "45m or less", max: 45 },
  { label: "1h or less", max: 60 },
];

const SERVING_CHOICES = [1, 2, 4, 6, 8];

/** Kitchen noises for the long wait — not a progress report, and not pretending to be one. */
const WRITING_LINES = [
  "Reading up on it…",
  "Getting the mise en place together…",
  "Checking your staples…",
  "Balancing salt, fat, acid, heat…",
  "Working out the timings…",
  "Writing it all down…",
];
const MEAL_LINES = [
  "Planning the menu…",
  "Making sure the oven can share…",
  "Checking your staples…",
  "Lining up the timings…",
  "Writing each dish out…",
  "Putting the game plan together…",
];

type Result = {
  dishes: Extraction[];
  game_plan: GamePlanStep[] | null;
  servings: number;
  /** The model's suggested name for a meal; null for one dish. */
  meal_title?: string | null;
};

type Session = {
  ask: string;
  maxActive: number | null;
  scope: MakeScope | null;
  result: Result | null;
  /** Saved rows, parallel to result.dishes — null where still a draft. */
  saved: (Recipe | null)[];
  /** What the result answers, so the button can say "another version". */
  answered: string | null;
  /** "19:00" once the cook says when dinner is; null until then. */
  serveTime: string | null;
  /** Cook something, or Plan the week. */
  mode?: "cook" | "week";
  /** A meal's name — the model's suggestion until the cook renames it. */
  mealTitle: string | null;
  /** Set once the meal is kept together in the Library. */
  savedMealId: string | null;
  saved_at: number;
};

/** Twelve hours, like Wing it: today's plan, not last week's. */
const SESSION_TTL = 12 * 60 * 60 * 1000;

export default function MakePage() {
  const [ask, setAsk] = useState("");
  const [mode, setMode] = useState<"cook" | "week">("cook");
  const [maxActive, setMaxActive] = useState<number | null>(null);
  /** The scope read thought this was a week: offer to switch instead of cramming it into a meal. */
  const [weekOffer, setWeekOffer] = useState<{ nights: number | null } | null>(null);
  const [presetNights, setPresetNights] = useState<number | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [example, setExample] = useState(0);
  const askRef = useRef<HTMLTextAreaElement | null>(null);

  const [scope, setScope] = useState<MakeScope | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState<(Recipe | null)[]>([]);
  const [answered, setAnswered] = useState<string | null>(null);

  const [scoping, setScoping] = useState(false);
  /** Waiting on the cook: the scope said servings need asking. */
  const [askServings, setAskServings] = useState(false);
  const [otherServings, setOtherServings] = useState("");
  const [writing, setWriting] = useState<string | null>(null);
  const writeAbort = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sheet, setSheet] = useState<number | null>(null);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addedCount, setAddedCount] = useState<number | null>(null);
  const [serveTime, setServeTime] = useState<string | null>(null);
  const [mealTitle, setMealTitle] = useState<string | null>(null);
  const [savedMealId, setSavedMealId] = useState<string | null>(null);

  // Only cycles while the box is empty — once you're typing, it's your words.
  useEffect(() => {
    if (ask) return;
    const t = setInterval(() => setExample((n) => (n + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(t);
  }, [ask]);

  // ------------------------------------------------------------------
  // A written recipe is a long wait you paid for, so the page survives
  // leaving it (or the PWA being evicted): inputs + results live in
  // localStorage, wiped on login/logout via clearUserDataCaches.
  // ------------------------------------------------------------------
  const skipSave = useRef(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MAKE_SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Session>;
      if (!s.saved_at || Date.now() - s.saved_at > SESSION_TTL) return;
      setAsk(s.ask ?? "");
      setMaxActive(s.maxActive ?? null);
      setScope(s.scope ?? null);
      // A session stored before the plan was structured holds plain strings —
      // normalize so it still renders (and can take a dinner time).
      setResult(s.result ? { ...s.result, game_plan: normalizeGamePlan(s.result.game_plan) } : null);
      setSaved(s.saved ?? []);
      setAnswered(s.answered ?? null);
      setServeTime(s.serveTime ?? null);
      setMode(s.mode === "week" ? "week" : "cook");
      setMealTitle(s.mealTitle ?? null);
      setSavedMealId(s.savedMealId ?? null);
    } catch {
      // corrupt/blocked storage — start clean
    }
  }, []);
  useEffect(() => {
    // The mount run carries the initial empty state; writing it would clobber
    // the stored session before the restore lands.
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    try {
      const s: Session = { ask, maxActive, scope, result, saved, answered, serveTime, mode, mealTitle, savedMealId, saved_at: Date.now() };
      localStorage.setItem(MAKE_SESSION_KEY, JSON.stringify(s));
    } catch {
      // out of quota or private mode — the page just forgets on leave
    }
  }, [ask, maxActive, scope, result, saved, answered, serveTime, mode, mealTitle, savedMealId]);

  /** The question as one comparable string — the chips are part of it. */
  const question = [ask.trim().toLowerCase(), maxActive ?? ""].join("|");
  const sameQuestion = answered !== null && answered === question;
  const busy = scoping || !!writing;

  function clearAll() {
    setScope(null);
    setResult(null);
    setSaved([]);
    setAnswered(null);
    setAskServings(false);
    setError(null);
    setAddedCount(null);
    setServeTime(null);
    setMealTitle(null);
    setSavedMealId(null);
    setWeekOffer(null);
    setResetSignal((n) => n + 1);
  }

  async function start() {
    if (!ask.trim() || busy) return;
    setError(null);
    setAddedCount(null);

    // Same question again: the scope still holds — skip straight to writing
    // another version for the same servings.
    if (sameQuestion && scope && result) {
      return write(scope, result.servings);
    }

    setScoping(true);
    setAskServings(false);
    try {
      const res = await fetch("/api/make/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: ask }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't read that.");
      const s = json.scope as MakeScope;
      setScope(s);
      // Several nights of dinners don't fit one meal — offer the week instead
      // of squeezing it in (that's how five dinners became one recipe).
      if (s.week_shaped) {
        setWeekOffer({ nights: s.nights_in_request });
        return;
      }
      await continueAsMeal(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that.");
    } finally {
      setScoping(false);
    }
  }

  /** After the scope read: ask for servings if it needs them, else write. */
  async function continueAsMeal(s: MakeScope) {
    setWeekOffer(null);
    if (s.servings_in_request == null && s.standard_yield == null) {
      setAskServings(true);
    } else {
      await write(s, null);
    }
  }

  async function write(s: MakeScope, servings: number | null) {
    setAskServings(false);
    setOtherServings("");
    const controller = new AbortController();
    writeAbort.current = controller;
    setWriting(s.kind === "meal" ? "Your meal" : s.dishes[0]?.title ?? "Your recipe");
    setError(null);
    try {
      const res = await fetch("/api/make/recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: ask, scope: s, servings, max_active_min: maxActive }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't write that one out.");
      const r = json as Result;
      setResult(r);
      setSaved(r.dishes.map(() => null));
      // A fresh write is a new meal, not an edit of one already saved.
      setMealTitle(r.meal_title ?? null);
      setSavedMealId(null);
      setServeTime(null);
      setAnswered(question);
      // One dish goes straight to the recipe — there's nothing else to look at.
      if (r.dishes.length === 1) setSheet(0);
    } catch (e) {
      // Cancelling is a choice, not a failure — no banner for it.
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "Couldn't write that one out.");
      }
    } finally {
      writeAbort.current = null;
      setWriting(null);
    }
  }

  /**
   * Replace one dish of the meal and take the game plan rewritten around it.
   * The new dish is a draft; a saved copy of the old one stays in the library
   * (a swap never deletes anything).
   */
  async function swap(i: number, hint: string) {
    if (!result || busy) return;
    const role = MEAL_ROLE[result.dishes[i]?.course] ?? "";
    const controller = new AbortController();
    writeAbort.current = controller;
    setWriting(`A new ${role ? role.toLowerCase() : "dish"}`);
    setError(null);
    try {
      const res = await fetch("/api/make/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: ask,
          dishes: result.dishes,
          index: i,
          hint,
          servings: result.servings,
          max_active_min: maxActive,
        }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't swap that one.");
      setResult((r) => {
        if (!r) return r;
        const dishes = [...r.dishes];
        dishes[i] = json.dish as Extraction;
        return { ...r, dishes, game_plan: (json.game_plan as GamePlanStep[] | null) ?? r.game_plan };
      });
      setSaved((prev) => {
        const next = [...prev];
        next[i] = null;
        return next;
      });
      setAddedCount(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "Couldn't swap that one.");
      }
    } finally {
      writeAbort.current = null;
      setWriting(null);
    }
  }

  async function saveDish(i: number): Promise<Recipe | null> {
    if (!result || saved[i]) return saved[i] ?? null;
    const res = await fetch("/api/recipes/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipe: result.dishes[i] }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Couldn't save that.");
      return null;
    }
    const row = json.recipe as Recipe;
    setSaved((prev) => {
      const next = [...prev];
      next[i] = row;
      return next;
    });
    return row;
  }

  async function saveFromSheet() {
    if (sheet === null || savingIndex !== null) return;
    setSavingIndex(sheet);
    await saveDish(sheet);
    setSavingIndex(null);
  }

  async function saveAll() {
    if (!result || savingAll) return;
    setSavingAll(true);
    setError(null);
    // One at a time: a failure stops the run with the rest left as drafts,
    // rather than leaving a half-saved meal you can't see the state of.
    const rows: (Recipe | null)[] = [];
    for (let i = 0; i < result.dishes.length; i++) {
      rows[i] = saved[i] ?? (await saveDish(i));
      if (!rows[i]) break;
    }
    if (rows.length === result.dishes.length && rows.every(Boolean)) {
      await keepMeal(rows.map((r) => (r as Recipe).id));
    }
    setSavingAll(false);
  }

  /**
   * Keep the meal together in the Library: create it the first time, update it
   * after a swap (new dish, new plan) rather than making a second copy.
   */
  async function keepMeal(recipeIds: string[]) {
    if (!result) return;
    const body = {
      title: (mealTitle ?? "").trim() || result.dishes[0]?.title || "Dinner",
      request: ask.trim() || null,
      servings: result.servings,
      game_plan: result.game_plan,
      serve_time: serveTime,
      recipe_ids: recipeIds,
    };
    const res = await fetch(savedMealId ? `/api/meals/${savedMealId}` : "/api/meals", {
      method: savedMealId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(savedMealId ? { ...body, serve_time: serveTime ?? "", request: undefined } : body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "The recipes saved, but the meal didn't — try Save all again.");
      return;
    }
    setSavedMealId(json.meal.id);
    if (!mealTitle) setMealTitle(json.meal.title);
  }

  /** Once the meal is in the Library, a rename or a dinner time saves there too. */
  function patchSavedMeal(fields: Record<string, unknown>) {
    if (!savedMealId) return;
    fetch(`/api/meals/${savedMealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }).catch(() => {
      // It still holds on this page; the Library copy catches up on the next save.
    });
  }

  const allSaved = !!result && result.dishes.length > 0 && saved.length === result.dishes.length && saved.every(Boolean);
  const isMeal = !!result && result.dishes.length > 1;
  // A batch size belongs to a single dish ("one 9×13 pan"); a meal shows its servings.
  const yieldLabel =
    !isMeal && scope?.standard_yield && scope.servings_in_request == null ? scope.standard_yield.label : null;

  return (
    <main className="px-4 pt-[max(env(safe-area-inset-top),16px)]">
      <h1 className="pr-11 font-display text-3xl font-bold">Make</h1>
      <p className="mt-1 text-sm text-smoke">
        {mode === "cook" ? "What do you want to eat? A dish or a whole meal" : "Dinners for the nights ahead"} — your{" "}
        <Link href="/staples" className="font-semibold text-char underline underline-offset-2">
          staples
        </Link>{" "}
        will be used where they fit, and anything missing can go on the list.
      </p>

      {/* Two kinds of ask, two layouts — so this one earns a control (unlike
          the dish/meal pills, which only repeated the words). */}
      <div className="mt-3 grid grid-cols-2 rounded-full bg-char/5 p-1" role="tablist" aria-label="What are you making?">
        {(
          [
            { value: "cook", label: "Cook something" },
            { value: "week", label: "Plan the week" },
          ] as const
        ).map((o) => (
          <button
            key={o.value}
            role="tab"
            aria-selected={mode === o.value}
            onClick={() => {
              setMode(o.value);
              setWeekOffer(null);
            }}
            className="relative rounded-full py-2 text-sm font-semibold"
          >
            {mode === o.value && (
              <motion.span
                layoutId="make-mode"
                transition={springUI}
                className="absolute inset-0 rounded-full bg-tile shadow-sm shadow-scrim/10"
              />
            )}
            <span className={`relative ${mode === o.value ? "text-char" : "text-smoke"}`}>{o.label}</span>
          </button>
        ))}
      </div>

      {/* The example sits over the box rather than in `placeholder`, which
          can't animate — and pr-11 is reserved for the ✕ either way, so text
          doesn't reflow when you start typing. */}
      <div className="relative mt-3">
        <textarea
          ref={askRef}
          value={ask}
          onChange={(e) => {
            setAsk(e.target.value);
            if (!e.target.value.trim()) clearAll();
          }}
          rows={3}
          aria-label="What do you want to make?"
          className="w-full resize-none rounded-xl border border-char/15 bg-surface py-3 pl-4 pr-11 text-base outline-none focus:border-flame"
        />
        {!ask && (
          <span className="pointer-events-none absolute left-4 right-11 top-3 text-base text-smoke/60">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={example}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22 }}
                className="block"
              >
                {(mode === "week" ? WEEK_EXAMPLES : EXAMPLES)[example % (mode === "week" ? WEEK_EXAMPLES : EXAMPLES).length]}…
              </motion.span>
            </AnimatePresence>
          </span>
        )}
        {ask && (
          <button
            onClick={() => {
              setAsk("");
              clearAll();
              askRef.current?.focus();
            }}
            aria-label="Clear"
            className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full text-smoke/70"
          >
            ✕
          </button>
        )}
      </div>

      {mode === "week" ? (
        <MakeWeek ask={ask} presetNights={presetNights} resetSignal={resetSignal} />
      ) : (
        <>
      <div className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
        {TIMES.map((t) => {
          const active = maxActive === t.max;
          return (
            <button
              key={t.label}
              onClick={() => setMaxActive(t.max)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
                active ? "bg-char text-tile" : "bg-char/5 text-smoke"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={springUI}
        onClick={start}
        disabled={!ask.trim() || busy || askServings}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-flame py-3.5 font-display font-bold text-accent-ink disabled:opacity-40"
      >
        {scoping && <Spinner />}
        {scoping
          ? "Reading that…"
          : sameQuestion
            ? "Write another version"
            : "Make it"}
      </motion.button>
      {error && <p className="mt-2 text-sm text-flame">{error}</p>}

      {/* Servings, asked only when it matters: a per-person dish with no
          number in the request. One tap answers it and the write starts. */}
      <AnimatePresence>
        {askServings && scope && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={springSoft}
            className="mt-4 rounded-xl border border-char/10 bg-surface p-4"
          >
            <p className="font-display text-base font-bold">How many servings?</p>
            <p className="mt-0.5 text-sm text-smoke">
              {scope.kind === "meal"
                ? scope.dishes.map((d) => d.title).join(" · ")
                : scope.dishes[0]?.title}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SERVING_CHOICES.map((n) => (
                <motion.button
                  key={n}
                  whileTap={{ scale: 0.94 }}
                  transition={springUI}
                  onClick={() => write(scope, n)}
                  className="h-11 min-w-11 rounded-full bg-char/5 px-4 font-display text-base font-bold"
                >
                  {n}
                </motion.button>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = parseInt(otherServings, 10);
                  if (n > 0 && n <= 50) write(scope, n);
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  value={otherServings}
                  onChange={(e) => setOtherServings(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  inputMode="numeric"
                  placeholder="Other"
                  aria-label="Other number of servings"
                  className="h-11 w-20 rounded-full border border-char/15 bg-tile px-3 text-center text-base outline-none focus:border-flame"
                />
                {otherServings && (
                  <button type="submit" className="h-11 rounded-full bg-char px-4 text-sm font-semibold text-tile">
                    Go
                  </button>
                )}
              </form>
            </div>
            <button
              onClick={() => setAskServings(false)}
              className="mt-3 text-sm font-semibold text-smoke underline underline-offset-2"
            >
              Never mind
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {result && !askServings && (
          <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6">
            <h2 className="font-display text-xs font-bold uppercase tracking-widest text-flame">
              {isMeal ? "Your meal" : "Your recipe"}
            </h2>
            {isMeal && (
              <EditableTitle
                value={mealTitle || result.dishes[0]?.title || "Dinner"}
                onChange={(t) => {
                  setMealTitle(t);
                  patchSavedMeal({ title: t });
                }}
                className="mt-1 font-display text-xl font-bold leading-tight"
              />
            )}
            <p className="mt-1 text-sm text-smoke">
              {yieldLabel ?? `Serves ${result.servings}`}
            </p>

            <div className="mt-2">
              <MealDishList
                dishes={result.dishes}
                status={result.dishes.map((_, i) => !!saved[i])}
                onOpen={setSheet}
                // Swapping is a meal thing — a single dish has "Write another
                // version" on the button above instead.
                onSwap={isMeal ? swap : undefined}
              />
            </div>

            {result.game_plan && (
              <div className="mt-4">
                <GamePlan
                  steps={result.game_plan}
                  serveTime={serveTime}
                  onServeTimeChange={(t) => {
                    setServeTime(t);
                    patchSavedMeal({ serve_time: t ?? "" });
                  }}
                />
              </div>
            )}

            {/* A meal saves and shops as one: save the lot, then one confirm
                step for every dish's ingredients. A single dish does both from
                its own sheet. */}
            {isMeal && (
              <div className="mt-3 space-y-2">
                {!allSaved && (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    transition={springUI}
                    onClick={saveAll}
                    disabled={savingAll}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-char py-3 font-display font-bold text-tile disabled:opacity-50"
                  >
                    {savingAll && <Spinner className="h-4 w-4" />}
                    {savingAll ? "Saving…" : "Save all to my library"}
                  </motion.button>
                )}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  transition={springUI}
                  onClick={() => setAddOpen(true)}
                  disabled={!allSaved}
                  className={`w-full rounded-xl py-3 font-display font-bold disabled:opacity-40 ${
                    addedCount ? "bg-herb text-chalk" : "border border-char/15 text-char"
                  }`}
                >
                  {addedCount ? `✓ ${addedCount} on the list` : "Add everything to grocery list"}
                </motion.button>
                {!allSaved && (
                  <p className="text-center text-xs text-smoke">
                    {savedMealId
                      ? "Save the new dish to update the meal in your Library."
                      : "Save the meal first, then add it to the list."}
                  </p>
                )}
                {allSaved && savedMealId && (
                  <p className="text-center text-xs text-smoke">
                    ✓ Kept together in your Library —{" "}
                    <Link href={`/?meal=${savedMealId}`} className="font-semibold text-char underline underline-offset-2">
                      open it under Meals
                    </Link>
                  </p>
                )}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>


      {/* The scope read heard several nights of dinners. */}
      <AnimatePresence>
        {weekOffer && scope && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 rounded-xl border border-char/10 bg-surface p-4"
          >
            <p className="font-display text-base font-bold">This sounds like a week of dinners.</p>
            <p className="mt-0.5 text-sm text-smoke">
              Plan it as a week? Each night gets its own recipe, and you can swap any one of them.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setPresetNights(weekOffer.nights);
                  setWeekOffer(null);
                  setMode("week");
                }}
                className="rounded-full bg-flame px-4 py-2 text-sm font-bold text-accent-ink"
              >
                Plan the week
              </button>
              <button
                onClick={() => continueAsMeal(scope)}
                className="rounded-full bg-char/5 px-4 py-2 text-sm font-semibold text-char"
              >
                No, one meal
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
        </>
      )}

      {/* Writing is the one wait long enough to look like a hang, so it gets a
          modal with a way out — same as Wing it. */}
      <AnimatePresence>
        {writing && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-scrim/50"
            />
            <motion.div
              role="dialog"
              aria-live="polite"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={springUI}
              className="fixed left-1/2 top-1/2 z-50 w-[min(88vw,20rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-tile p-5 text-center shadow-2xl"
            >
              <Spinner className="mx-auto h-7 w-7 text-flame" />
              <p className="mt-3 font-display text-lg font-bold leading-tight">{writing}</p>
              <CyclingLine
                lines={scope?.kind === "meal" ? MEAL_LINES : WRITING_LINES}
                className="mt-1 h-5 text-sm text-smoke"
              />
              <button
                onClick={() => writeAbort.current?.abort()}
                className="mt-4 w-full rounded-xl border border-char/15 py-2.5 text-sm font-semibold text-smoke"
              >
                Cancel
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet !== null && result?.dishes[sheet] && (
          <RecipeDetail
            key={sheet}
            recipe={saved[sheet] ?? draftRecipe(result.dishes[sheet])}
            draft={!saved[sheet]}
            saving={savingIndex === sheet}
            onSave={saveFromSheet}
            onClose={() => setSheet(null)}
            onChanged={(r) =>
              setSaved((prev) => {
                const next = [...prev];
                next[sheet] = r;
                return next;
              })
            }
            onDelete={() => {
              // Deleted from the library: back to a draft you could save again.
              setSaved((prev) => {
                const next = [...prev];
                next[sheet] = null;
                return next;
              });
              setSheet(null);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {addOpen && allSaved && (
          <AddToListSheet
            source={{ recipe_ids: saved.map((r) => (r as Recipe).id) }}
            title="Add the meal to your list"
            onClose={() => setAddOpen(false)}
            onAdded={(n) => setAddedCount(n)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
