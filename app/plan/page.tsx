"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PlannedMeal, Recipe } from "@/lib/types";
import { mealLabel, isNoCook } from "@/lib/types";
import { dayLabel, isToday, weekDates, weekStart, toISODate, isSunday } from "@/lib/week";
import { springSoft, springUI, springOvershoot } from "@/lib/springs";
import { PLAN_DRAFTS_KEY } from "@/lib/userCache";
import { PickerPortal } from "@/components/MealPicker";
import { TypeIn } from "@/components/TypeIn";
import { UndoToast, useUndoToast } from "@/components/UndoToast";
import { SundayFlow } from "@/components/SundayFlow";
import { AddToListSheet } from "@/components/AddToListSheet";
import { PlanMealSheet } from "@/components/PlanMealSheet";
import {
  PlanDraftRow,
  PlanCommitBar,
  DraftSkeleton,
  type ProposalOption,
  type PlanProposal,
} from "@/components/PlanDrafts";
import { PlanSetupSheet } from "@/components/PlanSetupSheet";
import type { PlanSource } from "@/app/api/planner/generate/route";

/**
 * One suggestion sitting in a night, still undecided. `seen` is every title
 * that's been shown for this date, so a reroll can be told what not to repeat.
 */
type Draft = { options: ProposalOption[]; idx: number; seen: string[] };

// Past this many options per night, Swap wraps around instead of fetching —
// a taste boundary as much as a cost one.
const MAX_OPTIONS = 5;
const DRAFTS_TTL_MS = 12 * 60 * 60 * 1000;

export default function PlanPage() {
  const [meals, setMeals] = useState<PlannedMeal[]>([]);
  const [dates, setDates] = useState<string[]>(weekDates());
  const [weekOffset, setWeekOffset] = useState(0);
  const [pickerDate, setPickerDate] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingDates, setGeneratingDates] = useState<string[]>([]);
  const [justGenerated, setJustGenerated] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [sundayOpen, setSundayOpen] = useState(false);
  const [addSheetFor, setAddSheetFor] = useState<PlannedMeal | null>(null);
  const [openMealFor, setOpenMealFor] = useState<PlannedMeal | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [draftSource, setDraftSource] = useState<PlanSource>("mix");
  const [rerolling, setRerolling] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  // After an apply: the new meals whose ingredients could go on the list.
  const [listOffer, setListOffer] = useState<PlannedMeal[] | null>(null);
  const [listSheetOpen, setListSheetOpen] = useState(false);
  const { toast, show, undo } = useUndoToast();
  const skipDraftSave = useRef(true);

  const startDate = useMemo(() => {
    const d = weekStart();
    d.setDate(d.getDate() + weekOffset * 7);
    return toISODate(d);
  }, [weekOffset]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/planner?start=${startDate}`);
    if (!res.ok) return;
    const json = await res.json();
    setDates(json.dates);
    setMeals(json.meals ?? []);
  }, [startDate]);

  useEffect(() => {
    load();
  }, [load]);

  const byDate = useMemo(() => {
    const m = new Map<string, PlannedMeal>();
    for (const meal of meals) m.set(meal.date, meal);
    return m;
  }, [meals]);

  /**
   * Drafts survive leaving the page mid-review (same pattern as Wing it).
   * Restored once on mount; pruned whenever a date turns out to be committed.
   */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PLAN_DRAFTS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as {
        source?: PlanSource;
        drafts?: Record<string, Draft>;
        saved_at?: number;
      };
      if (!s.saved_at || Date.now() - s.saved_at > DRAFTS_TTL_MS) return;
      if (s.drafts && Object.keys(s.drafts).length) {
        setDrafts(s.drafts);
        if (s.source) setDraftSource(s.source);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (skipDraftSave.current) {
      skipDraftSave.current = false;
      return;
    }
    try {
      if (Object.keys(drafts).length === 0) localStorage.removeItem(PLAN_DRAFTS_KEY);
      else
        localStorage.setItem(
          PLAN_DRAFTS_KEY,
          JSON.stringify({ source: draftSource, drafts, saved_at: Date.now() })
        );
    } catch {}
  }, [drafts, draftSource]);

  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const m of meals)
        if (next[m.date]) {
          delete next[m.date];
          changed = true;
        }
      return changed ? next : prev;
    });
  }, [meals]);

  const draftDates = useMemo(
    () => dates.filter((d) => drafts[d] && !byDate.has(d)),
    [dates, drafts, byDate]
  );

  async function pick(body: Record<string, unknown>) {
    const date = pickerDate;
    setPickerDate(null);
    if (!date) return;
    const res = await fetch("/api/planner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, date }),
    });
    const json = await res.json();
    if (json.meal) setMeals((prev) => [...prev.filter((m) => m.date !== date), json.meal]);
  }

  async function clearNight(meal: PlannedMeal) {
    setMeals((prev) => prev.filter((m) => m.id !== meal.id));
    // Removing a meal offers to pull its unchecked items back out (§5).
    const res = await fetch(`/api/planner/${meal.id}?pull_items=1`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    const removed = json.removed_items ?? 0;
    show(
      removed
        ? `Removed ${mealLabel(meal)} · pulled ${removed} item${removed === 1 ? "" : "s"} off the list`
        : `Removed ${mealLabel(meal)}`,
      async () => {
        await fetch("/api/planner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: meal.date,
            source_type: meal.source_type,
            recipe_id: meal.recipe_id,
            quick_meal_id: meal.quick_meal_id,
            title: meal.title,
            note: meal.note,
            reason: meal.reason,
          }),
        });
        await load();
      }
    );
  }

  /** Deleting a recipe from its plan-sheet is the same deferred delete as the library. */
  function deleteRecipeFromPlan(r: Recipe) {
    setOpenMealFor(null);
    setMeals((prev) => prev.filter((m) => m.recipe_id !== r.id));
    show(
      `Deleted ${r.title}`,
      () => load(),
      async () => {
        await fetch(`/api/recipes/${r.id}`, { method: "DELETE" });
      }
    );
  }

  /** Promote a typed night to a quick meal, then relink this night to it. */
  async function saveAsQuickMeal(meal: PlannedMeal): Promise<boolean> {
    try {
      const qmRes = await fetch("/api/quick-meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: meal.title, ingredients: meal.ingredients ?? [] }),
      });
      const qmJson = await qmRes.json();
      if (!qmRes.ok || !qmJson.quick_meal?.id) return false;
      const res = await fetch("/api/planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: meal.date,
          source_type: "quick_meal",
          quick_meal_id: qmJson.quick_meal.id,
        }),
      });
      const json = await res.json();
      if (!json.meal) return false;
      setMeals((prev) => [...prev.filter((m) => m.date !== meal.date), json.meal]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Propose, don't write: suggestions land in their nights as drafts and the
   * week itself is the review surface. Nothing is written until the commit bar.
   */
  async function generate(nights: string[], source: PlanSource) {
    setSetupOpen(false);
    setGenerating(true);
    setGeneratingDates(nights);
    setDraftSource(source);
    setError(null);
    let res: Response;
    let json: { proposals?: PlanProposal[]; error?: string; message?: string };
    try {
      // A killed serverless function never answers — without this the button
      // spins forever. 3 minutes comfortably covers a slow proposal call.
      res = await fetch("/api/planner/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: startDate, dates: nights, source }),
        signal: AbortSignal.timeout(180_000),
      });
      json = await res.json();
    } catch {
      setGenerating(false);
      setGeneratingDates([]);
      setError("That took too long — try again in a moment.");
      return;
    }
    setGenerating(false);
    setGeneratingDates([]);
    if (!res.ok) {
      setError(json.error ?? "Couldn't plan the week.");
      return;
    }
    const fresh = json.proposals ?? [];
    if (!fresh.length) {
      setError(json.message ?? "Nothing to suggest.");
      return;
    }
    setDrafts((prev) => {
      const next = { ...prev };
      for (const p of fresh)
        next[p.date] = { options: p.options, idx: 0, seen: p.options.map((o) => o.title) };
      return next;
    });
    const missing = nights.length - fresh.length;
    if (missing > 0)
      setError(
        `Nothing came to mind for ${missing} night${missing === 1 ? "" : "s"} — try again or pick manually.`
      );
  }

  /** Jump straight to a visible alternate — Option A / Option B pills. */
  function selectOption(date: string, idx: number) {
    const d = drafts[date];
    if (!d || idx === d.idx || idx < 0 || idx >= d.options.length) return;
    setDrafts((prev) => ({ ...prev, [date]: { ...d, idx } }));
  }

  /**
   * "Something else": fetch one fresh scoped suggestion for just this night —
   * told everything already seen, so it can't repeat.
   */
  async function fetchNewOption(date: string) {
    const d = drafts[date];
    if (!d || rerolling || d.options.length >= MAX_OPTIONS) return;
    setRerolling(date);
    setError(null);
    const avoid = [
      ...new Set([
        ...d.seen,
        ...Object.entries(drafts)
          .filter(([dt]) => dt !== date)
          .map(([, od]) => od.options[od.idx]?.title)
          .filter(Boolean),
      ]),
    ];
    try {
      const res = await fetch("/api/planner/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: startDate,
          dates: [date],
          source: draftSource,
          avoid_titles: avoid,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const json = await res.json();
      const fresh: ProposalOption[] = (json.proposals?.[0]?.options ?? []).filter(
        (o: ProposalOption) => !d.seen.includes(o.title)
      );
      if (!fresh.length) {
        setError("Nothing new came to mind for that night — try again in a moment.");
        return;
      }
      setDrafts((prev) => {
        const cur = prev[date];
        if (!cur) return prev; // skipped while the fetch was in flight
        return {
          ...prev,
          [date]: {
            options: [...cur.options, ...fresh],
            idx: cur.options.length,
            seen: [...cur.seen, ...fresh.map((o) => o.title)],
          },
        };
      });
    } catch {
      setError("Couldn't fetch another idea — try again in a moment.");
    } finally {
      setRerolling(null);
    }
  }

  function skipDraft(date: string) {
    const d = drafts[date];
    if (!d) return;
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[date];
      return next;
    });
    const { weekday } = dayLabel(date);
    show(`Skipped the ${weekday} suggestion`, () => {
      setDrafts((prev) => ({ ...prev, [date]: d }));
    });
  }

  function discardDrafts() {
    const snapshot = drafts;
    setDrafts({});
    show("Suggestions discarded", () => setDrafts(snapshot));
  }

  /** The one write: every remaining draft's current option, re-validated server-side. */
  async function applyDrafts() {
    if (applying || !draftDates.length) return;
    setApplying(true);
    setError(null);
    const picks = draftDates.map((date) => {
      const d = drafts[date];
      const o = d.options[d.idx];
      return o.source_type === "idea"
        ? {
            date,
            source_type: o.source_type,
            title: o.title,
            ingredients: o.ingredients,
            reason: o.reason,
          }
        : { date, source_type: o.source_type, id: o.id, reason: o.reason };
    });
    let json: { meals?: PlannedMeal[]; skipped?: number; error?: string } = {};
    let ok = false;
    try {
      const res = await fetch("/api/planner/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picks }),
      });
      json = await res.json().catch(() => ({}));
      ok = res.ok;
    } catch {}
    setApplying(false);
    if (!ok) {
      setError(json.error ?? "Couldn't add those to the plan.");
      return;
    }
    const fresh = json.meals ?? [];
    const skipped = json.skipped ?? 0;
    setDrafts({});
    if (!fresh.length) {
      setError("Those nights got planned in the meantime — nothing added.");
      return;
    }
    // §7: approved picks settle into their slots, reasoning typing in beneath.
    setJustGenerated(new Set(fresh.map((m) => m.id)));
    setMeals((prev) => [...prev.filter((m) => !fresh.some((f) => f.date === m.date)), ...fresh]);
    setTimeout(() => setJustGenerated(new Set()), 4000);
    if (skipped > 0) setError(`${skipped} night${skipped === 1 ? " was" : "s were"} already taken.`);
    const withIngredients = fresh.filter(
      (m) => m.recipes || m.quick_meals || (m.ingredients?.length ?? 0) > 0
    );
    if (withIngredients.length) setListOffer(withIngredients);
  }

  /** Both fill buttons (page + Sunday flow) start at the setup step. */
  async function startPlanning() {
    setSundayOpen(false);
    setSetupOpen(true);
  }

  const todayISO = toISODate(new Date());
  const emptyCount = dates.filter((d) => !byDate.has(d)).length;
  const noCookCount = meals.filter((m) => dates.includes(m.date) && isNoCook(m)).length;
  const plannedCount = dates.length - emptyCount - noCookCount;
  // Nights with nothing at all — no meal, no draft, not already behind you —
  // are what setup can offer. Past nights are history, not decisions.
  const openDates = dates.filter(
    (d) => !byDate.has(d) && !drafts[d] && d >= todayISO
  );
  const openCount = dates.filter(
    (d) => !byDate.has(d) && !drafts[d] && d >= todayISO
  ).length;
  const weekIsOver = dates.every((d) => d < todayISO);

  const summary = [
    plannedCount > 0 && `${plannedCount} planned`,
    noCookCount > 0 && `${noCookCount} no-cook`,
    openCount > 0 && `${openCount} open`,
    draftDates.length > 0 && `${draftDates.length} suggested`,
  ]
    .filter(Boolean)
    .join(" · ");

  const singleDraftLabel =
    draftDates.length === 1 ? dayLabel(draftDates[0]).weekday : null;

  return (
    <main className="px-4 pt-[max(env(safe-area-inset-top),16px)]">
      {/* pr-11 keeps the title clear of the fixed menu button */}
      <h1 className="pr-11 font-display text-3xl font-bold">Plan</h1>

      {/* The arrows lead, and the week they land on reads off them — the
          label is the answer to the control beside it, so they belong on
          one line rather than at opposite ends of the header. */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            aria-label="Previous week"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-char/5 text-smoke"
          >
            ‹
          </button>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            aria-label="Next week"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-char/5 text-smoke"
          >
            ›
          </button>
        </div>
        <p className="min-w-0 flex-1 truncate text-sm text-smoke">
          {weekOffset === 0 ? "This week" : weekOffset === 1 ? "Next week" : `Week of ${startDate}`}
          {summary && ` · ${summary}`}
        </p>
      </div>

      {/* Sunday leads with the ritual; other days it's a quiet link (§1). */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        transition={springUI}
        onClick={() => setSundayOpen(true)}
        className={`mt-3 w-full rounded-xl px-4 py-3 text-left ${
          isSunday() ? "bg-flame text-accent-ink" : "bg-char/5 text-char"
        }`}
      >
        <span className="block font-display text-base font-bold">
          {isSunday() ? "It's Sunday — run the ritual" : "Sunday flow"}
        </span>
        <span className={`block text-sm ${isSunday() ? "text-chalk/80" : "text-smoke"}`}>
          Plan · review the list · check staples · shop · archive
        </span>
      </motion.button>

      <div className="mt-4 space-y-2">
        {dates.map((date) => {
          const meal = byDate.get(date);
          const draft = !meal ? drafts[date] : undefined;
          const isThinking = !meal && !draft && generatingDates.includes(date);
          const { weekday, day } = dayLabel(date);
          const isNew = meal && justGenerated.has(meal.id);
          const noCook = meal ? isNoCook(meal) : false;
          const isPast = date < todayISO;
          return (
            <motion.div
              key={date}
              layout
              transition={springSoft}
              className={`flex items-stretch gap-3 rounded-[14px] border p-3 ${
                draft || isThinking
                  ? "border-dashed border-flame/50 bg-flame/5"
                  : isPast
                    ? "border-transparent bg-transparent"
                    : isToday(date)
                      ? "border-flame/40 bg-flame/5"
                      : "border-char/10 bg-surface"
              }`}
            >
              <div className="flex w-10 shrink-0 flex-col items-center justify-center">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-smoke">
                  {weekday}
                </span>
                <span className="font-display text-lg font-bold leading-none">{day}</span>
              </div>

              <div className="min-w-0 flex-1">
                <AnimatePresence mode="wait">
                  {meal ? (
                    <motion.div
                      key={meal.id}
                      // Approved picks fly in from the side, staggered.
                      initial={isNew ? { opacity: 0, x: 40, scale: 0.94 } : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={springOvershoot}
                      // Tapping a filled night opens its detail — a recipe's
                      // full sheet, or a thinner one for a typed meal. The
                      // row's own buttons stop propagation so they stay themselves.
                      onClick={isPast ? undefined : () => setOpenMealFor(meal)}
                      className={isPast ? undefined : "cursor-pointer"}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`min-w-0 flex-1 truncate ${
                            noCook
                              ? "text-[15px] italic text-smoke"
                              : "font-display text-[15px] font-bold"
                          }`}
                        >
                          {mealLabel(meal)}
                        </p>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              clearNight(meal);
                            }}
                            aria-label="Clear night"
                            className="px-1 text-smoke/60"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {noCook ? (
                        <p className="mt-0.5 text-xs text-smoke/70">no cooking tonight</p>
                      ) : (
                        <>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-smoke">
                            {meal.recipes?.time_active_min != null && (
                              <span>{meal.recipes.time_active_min}m active</span>
                            )}
                            {meal.source_type === "quick_meal" && <span>quick meal</span>}
                            {meal.source_type === "freeform" && <span>typed</span>}
                          </div>

                          {meal.reason && (
                            <p className="mt-1 text-xs italic text-smoke">
                              <TypeIn text={meal.reason} delay={isNew ? 260 : 0} />
                            </p>
                          )}
                        </>
                      )}

                      {/* Footer — always present, always the same height, so
                          a night doesn't reflow when it gains or loses an
                          ingredient action. */}
                      <div className="mt-2 flex min-h-[30px] items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {/* Only when there's actually something to add — a
                              quick meal saved from a typed night has no
                              ingredient list, so the button would dead-end. */}
                          {(meal.recipes ||
                            (meal.quick_meals?.ingredients?.length ?? 0) > 0 ||
                            (meal.ingredients?.length ?? 0) > 0) && (
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              transition={springUI}
                              onClick={(e) => {
                                e.stopPropagation();
                                setAddSheetFor(meal);
                              }}
                              className="rounded-full bg-char/8 px-3 py-1 text-xs font-semibold"
                            >
                              Add ingredients to list
                            </motion.button>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPickerDate(date);
                          }}
                          className="shrink-0 px-1 py-1 text-xs font-semibold text-smoke/80"
                        >
                          Change
                        </button>
                      </div>
                    </motion.div>
                  ) : draft ? (
                    <motion.div
                      key={`draft-${draft.options[draft.idx]?.title ?? draft.idx}`}
                      initial={{ opacity: 0, x: 24, scale: 0.97 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={springOvershoot}
                    >
                      <PlanDraftRow
                        option={draft.options[draft.idx]}
                        optionIdx={draft.idx}
                        optionCount={draft.options.length}
                        canFetchMore={draft.options.length < MAX_OPTIONS}
                        swapping={rerolling === date}
                        onSelect={(i) => selectOption(date, i)}
                        onFetchNew={() => fetchNewOption(date)}
                        onSkip={() => skipDraft(date)}
                      />
                    </motion.div>
                  ) : isThinking ? (
                    <motion.div
                      key="thinking"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <DraftSkeleton weekday={weekday} />
                    </motion.div>
                  ) : isPast ? (
                    // A night that already happened isn't a decision — no
                    // invitation to fill it, just a quiet gap in the record.
                    <div key="past" className="h-full py-2" aria-hidden />
                  ) : (
                    <motion.button
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setPickerDate(date)}
                      className="flex h-full w-full flex-col justify-center rounded-lg py-2 text-left"
                    >
                      <span className="text-sm text-smoke">+ Add dinner</span>
                      {/* Same footer slot as a planned night, so filling or
                          clearing a night doesn't jump the row's height. */}
                      <span className="mt-2 flex min-h-[30px] items-center justify-end text-xs font-semibold text-smoke/80">
                        Plan
                      </span>
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* The ask lives under the week it acts on. Clearance below grows while
          the commit bar is up so it never buries the button. */}
      <div className={`mt-4 ${draftDates.length || listOffer ? "pb-44" : "pb-24"}`}>
        <motion.button
          whileTap={{ scale: 0.97 }}
          transition={springUI}
          onClick={startPlanning}
          disabled={generating || openDates.length === 0}
          className="w-full rounded-xl bg-flame py-3 font-display text-sm font-bold text-accent-ink disabled:opacity-40"
        >
          {generating
            ? "Thinking about your week…"
            : openDates.length === 0
              ? draftDates.length > 0
                ? "Suggestions ready above"
                : weekIsOver
                  ? "This week's in the books"
                  : "Every night is planned"
              : "Plan this week for me"}
        </motion.button>
        {error && <p className="mt-2 text-sm text-flame">{error}</p>}
      </div>

      <AnimatePresence>
        {draftDates.length > 0 ? (
          <PlanCommitBar
            key="review"
            phase="review"
            count={draftDates.length}
            singleLabel={singleDraftLabel}
            busy={applying}
            onApply={applyDrafts}
            onDiscard={discardDrafts}
            onShowList={() => {}}
            onDismissOffer={() => {}}
          />
        ) : listOffer ? (
          <PlanCommitBar
            key="offer"
            phase="offer"
            count={0}
            singleLabel={null}
            busy={false}
            onApply={() => {}}
            onDiscard={() => {}}
            onShowList={() => setListSheetOpen(true)}
            onDismissOffer={() => setListOffer(null)}
          />
        ) : null}
      </AnimatePresence>

      <PickerPortal date={pickerDate} onClose={() => setPickerDate(null)} onPick={pick} />
      <AnimatePresence>
        {openMealFor && (
          <PlanMealSheet
            key={openMealFor.id}
            meal={openMealFor}
            onClose={() => setOpenMealFor(null)}
            onDeleteRecipe={deleteRecipeFromPlan}
            onSaveAsQuickMeal={saveAsQuickMeal}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {setupOpen && (
          <PlanSetupSheet
            emptyDates={openDates}
            onClose={() => setSetupOpen(false)}
            onSubmit={generate}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {addSheetFor && (
          <AddToListSheet
            source={{ planned_meal_id: addSheetFor.id }}
            title={`Add for ${mealLabel(addSheetFor)}`}
            onClose={() => setAddSheetFor(null)}
            onAdded={() => {}}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {listSheetOpen && listOffer && (
          <AddToListSheet
            source={{ planned_meal_ids: listOffer.map((m) => m.id) }}
            title="What you'll need"
            onClose={() => setListSheetOpen(false)}
            onAdded={() => {
              setListSheetOpen(false);
              setListOffer(null);
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sundayOpen && (
          <SundayFlow
            startDate={startDate}
            meals={meals}
            emptyCount={emptyCount}
            onClose={() => setSundayOpen(false)}
            onGenerate={startPlanning}
            onRefresh={load}
          />
        )}
      </AnimatePresence>
      <UndoToast toast={toast} onUndo={undo} raised={draftDates.length > 0 || !!listOffer} />
    </main>
  );
}
