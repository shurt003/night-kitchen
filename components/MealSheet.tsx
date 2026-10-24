"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Recipe } from "@/lib/types";
import type { SavedMeal } from "@/lib/savedMeals";
import type { GamePlanStep } from "@/lib/gamePlan";
import { springSoft, springUI } from "@/lib/springs";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { EditableTitle } from "./EditableTitle";
import { MealDishList, MEAL_ROLE } from "./MealDishList";
import { GamePlan } from "./GamePlan";
import { AddToListSheet } from "./AddToListSheet";
import { DeleteMealSheet } from "./DeleteMealSheet";
import { CyclingLine } from "./CyclingLine";
import { Spinner } from "./Spinner";

const SWAP_LINES = [
  "Rethinking the plate…",
  "Checking it suits the rest…",
  "Checking your staples…",
  "Re-timing the game plan…",
  "Writing it out…",
];

/** A saved recipe in the shape the swap route reads (it validates as a recipe write). */
function asDraft(r: Recipe) {
  return {
    title: r.title,
    description: r.description ?? "",
    ingredients: r.ingredients ?? [],
    steps: r.steps ?? [],
    servings: r.servings,
    time_total_min: r.time_total_min,
    time_active_min: r.time_active_min,
    tags: r.tags ?? [],
    cuisine: r.cuisine,
    course: r.course ?? "misc",
    season: r.season ?? [],
    occasion: r.occasion ?? [],
    main_ingredients: r.main_ingredients ?? [],
    source_name: r.source_name,
  };
}

/**
 * A saved meal, laid out like the Make results it came from: the dishes, the
 * game plan (with dinner time), one-tap shopping, and swapping a dish. Each
 * change saves straight away.
 */
export function MealSheet({
  meal,
  onClose,
  onChanged,
  onOpenRecipe,
  onDelete,
}: {
  meal: SavedMeal;
  onClose: () => void;
  onChanged: (m: SavedMeal) => void;
  onOpenRecipe: (r: Recipe) => void;
  onDelete: (m: SavedMeal, withRecipes: boolean) => void;
}) {
  useBodyScrollLock();
  const [addOpen, setAddOpen] = useState(false);
  const [addedCount, setAddedCount] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(fields: Record<string, unknown>, optimistic?: Partial<SavedMeal>) {
    if (optimistic) onChanged({ ...meal, ...optimistic });
    setError(null);
    const res = await fetch(`/api/meals/${meal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Put it back — a change that didn't save shouldn't look saved.
      onChanged(meal);
      setError(json.error ?? "Couldn't save that.");
      return null;
    }
    onChanged(json.meal as SavedMeal);
    return json.meal as SavedMeal;
  }

  async function swap(i: number, hint: string) {
    if (swapping) return;
    const role = MEAL_ROLE[meal.dishes[i]?.recipe.course ?? ""] ?? "";
    setSwapping(`A new ${role ? role.toLowerCase() : "dish"}`);
    setError(null);
    try {
      const res = await fetch("/api/make/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: meal.request || meal.title,
          dishes: meal.dishes.map((d) => asDraft(d.recipe)),
          index: i,
          hint,
          servings: meal.servings ?? meal.dishes[0]?.recipe.servings ?? 4,
          max_active_min: null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't swap that one.");

      // A saved meal holds saved recipes, so the new dish is saved straight
      // away; the old one stays in the library (a swap never deletes).
      const saved = await fetch("/api/recipes/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe: json.dish }),
      });
      const savedJson = await saved.json();
      if (!saved.ok) throw new Error(savedJson.error ?? "Couldn't save the new dish.");

      const ids = meal.dishes.map((d) => d.recipe.id);
      ids[i] = (savedJson.recipe as Recipe).id;
      await patch({ recipe_ids: ids, game_plan: (json.game_plan as GamePlanStep[] | null) ?? meal.game_plan });
      window.dispatchEvent(new CustomEvent("recipe-captured"));
      setAddedCount(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't swap that one.");
    } finally {
      setSwapping(null);
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-scrim/50"
      />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24, transition: { duration: 0.18 } }}
        transition={springSoft}
        className="fixed inset-x-0 bottom-0 top-[max(env(safe-area-inset-top),12px)] z-40 mx-auto max-w-2xl overflow-y-auto rounded-t-3xl bg-tile shadow-2xl"
      >
        <div className="p-5 pb-28">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-display text-xs font-bold uppercase tracking-widest text-flame">Meal</p>
              <EditableTitle
                value={meal.title}
                onChange={(title) => patch({ title }, { title })}
                className="mt-1 font-display text-2xl font-bold leading-tight"
              />
              <p className="mt-1 text-sm text-smoke">
                {meal.dishes.length} {meal.dishes.length === 1 ? "dish" : "dishes"}
                {meal.servings ? ` · serves ${meal.servings}` : ""}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-char/5 text-char"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden className="h-5 w-5">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {error && <p className="mt-3 text-sm text-flame">{error}</p>}

          <div className="mt-4">
            <MealDishList
              dishes={meal.dishes.map((d) => ({
                title: d.recipe.title,
                course: d.recipe.course ?? "misc",
                description: d.recipe.description ?? "",
                time_active_min: d.recipe.time_active_min,
                time_total_min: d.recipe.time_total_min,
              }))}
              onOpen={(i) => meal.dishes[i] && onOpenRecipe(meal.dishes[i].recipe)}
              onSwap={meal.dishes.length > 1 ? swap : undefined}
            />
          </div>

          {meal.game_plan && meal.game_plan.length > 0 && (
            <div className="mt-4">
              <GamePlan
                steps={meal.game_plan}
                serveTime={meal.serve_time}
                onServeTimeChange={(t) => patch({ serve_time: t ?? "" }, { serve_time: t })}
              />
            </div>
          )}

          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={springUI}
            onClick={() => setAddOpen(true)}
            className={`mt-4 w-full rounded-xl py-3 font-display font-bold ${
              addedCount ? "bg-herb text-chalk" : "bg-char text-tile"
            }`}
          >
            {addedCount ? `✓ ${addedCount} on the list` : "Add everything to grocery list"}
          </motion.button>

          <button
            onClick={() => setConfirmDelete(true)}
            className="mt-8 w-full py-2 text-sm font-semibold text-flame"
          >
            Delete this meal
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {addOpen && (
          <AddToListSheet
            source={{ recipe_ids: meal.dishes.map((d) => d.recipe.id) }}
            title={`Add ${meal.title} to your list`}
            onClose={() => setAddOpen(false)}
            onAdded={(n) => setAddedCount(n)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDelete && (
          <DeleteMealSheet
            title={meal.title}
            recipeCount={new Set(meal.dishes.map((d) => d.recipe.id)).size}
            onClose={() => setConfirmDelete(false)}
            onChoose={(withRecipes) => {
              setConfirmDelete(false);
              onDelete(meal, withRecipes);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {swapping && (
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
              <p className="mt-3 font-display text-lg font-bold leading-tight">{swapping}</p>
              <CyclingLine lines={SWAP_LINES} className="mt-1 h-5 text-sm text-smoke" />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
