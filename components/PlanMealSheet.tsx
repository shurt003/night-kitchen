"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { PlannedMeal, Recipe } from "@/lib/types";
import { mealLabel } from "@/lib/types";
import { springUI } from "@/lib/springs";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { RecipeDetail } from "./RecipeDetail";

/**
 * What a planned night opens to. A recipe gets the same full sheet as the
 * library (editing, cook mode, delete all live there — never on the card).
 * A quick meal or typed night gets a thinner sheet built from just what's on
 * the row itself, with no recipe underneath to fetch.
 */
export function PlanMealSheet({
  meal,
  onClose,
  onDeleteRecipe,
  onSaveAsQuickMeal,
}: {
  meal: PlannedMeal;
  onClose: () => void;
  onDeleteRecipe: (recipe: Recipe) => void;
  onSaveAsQuickMeal: (meal: PlannedMeal) => Promise<boolean>;
}) {
  if (meal.source_type === "recipe" && meal.recipes) {
    const r = meal.recipes;
    // A stub — RecipeDetail fetches the full row (steps, servings, notes…)
    // the moment it mounts and replaces this with the real thing.
    const stub: Recipe = {
      id: r.id,
      title: r.title,
      description: "",
      ingredients: r.ingredients,
      steps: [],
      servings: null,
      time_total_min: null,
      time_active_min: r.time_active_min,
      status: "want_to_try",
      hearts: r.hearts,
      effort: r.effort,
      notes: "",
      tags: [],
      cuisine: null,
      course: null,
      season: [],
      occasion: [],
      main_ingredients: [],
      source_url: null,
      source_name: null,
      source_type: "manual",
      image_url: r.image_url,
      image_thumb_url: null,
      capture_status: "ready",
      capture_error: null,
      capture_gaps: [],
      possible_duplicate_of: null,
      created_at: "",
      updated_at: "",
    };
    return (
      <RecipeDetail
        key={r.id}
        recipe={stub}
        onClose={onClose}
        onChanged={() => {}}
        onDelete={onDeleteRecipe}
      />
    );
  }

  return <ThinMealSheet meal={meal} onClose={onClose} onSaveAsQuickMeal={onSaveAsQuickMeal} />;
}

function ThinMealSheet({
  meal,
  onClose,
  onSaveAsQuickMeal,
}: {
  meal: PlannedMeal;
  onClose: () => void;
  onSaveAsQuickMeal: (meal: PlannedMeal) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBodyScrollLock();

  const title = mealLabel(meal);
  const ingredients = meal.quick_meals?.ingredients ?? meal.ingredients ?? [];
  // Only a typed night can be promoted — a quick meal is already one.
  const offerSaveAsQuickMeal = meal.source_type === "freeform";

  async function save() {
    setSaving(true);
    setError(null);
    const ok = await onSaveAsQuickMeal(meal);
    setSaving(false);
    if (ok) onClose();
    else setError("Couldn't save that — try again in a moment.");
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 bg-scrim/50"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={springUI}
        // Above the nav bar (z-40), same as the meal picker — otherwise the
        // nav floats over the sheet's own footer button.
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] max-w-2xl flex-col rounded-t-3xl bg-tile p-5 pb-[max(env(safe-area-inset-bottom),20px)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3">
          <h2 className="min-w-0 flex-1 font-display text-xl font-bold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-char/5 text-smoke"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {ingredients.length > 0 && (
            <>
              <h3 className="font-display text-sm font-bold uppercase tracking-wide text-smoke">
                Ingredients
              </h3>
              <ul className="mt-2 space-y-1.5">
                {ingredients.map((ing, i) => (
                  <li key={i} className="text-[15px]">
                    {(ing.quantity || ing.unit) && (
                      <span className="font-semibold">
                        {ing.quantity ? `${ing.quantity} ` : ""}
                        {ing.unit ?? ""}
                      </span>
                    )}{" "}
                    {ing.item}
                    {ing.note && <span className="text-smoke"> — {ing.note}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {meal.note && (
            <div className="mt-4 -rotate-[0.4deg] rounded-xl bg-yolk/40 p-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-char/60">Note</p>
              <p className="mt-1 font-hand text-xl leading-snug text-char">{meal.note}</p>
            </div>
          )}

          {!ingredients.length && !meal.note && (
            <p className="py-6 text-center text-sm text-smoke">Just the name for now.</p>
          )}
        </div>

        {offerSaveAsQuickMeal && (
          <div className="mt-3 shrink-0">
            <motion.button
              whileTap={{ scale: 0.97 }}
              transition={springUI}
              onClick={save}
              disabled={saving}
              className="w-full rounded-xl bg-char py-3 font-display text-sm font-bold text-tile disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save as quick meal"}
            </motion.button>
            {error && <p className="mt-2 text-center text-sm text-flame">{error}</p>}
          </div>
        )}
      </motion.div>
    </>
  );
}
