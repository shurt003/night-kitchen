"use client";

import { motion } from "motion/react";
import { springUI } from "@/lib/springs";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

/**
 * The one place a delete asks first: a meal holds recipes that were saved in
 * their own right, so whether they go too is a real choice. Either answer
 * still gets the undo toast afterwards.
 */
export function DeleteMealSheet({
  title,
  recipeCount,
  onChoose,
  onClose,
}: {
  title: string;
  recipeCount: number;
  onChoose: (withRecipes: boolean) => void;
  onClose: () => void;
}) {
  useBodyScrollLock();
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-scrim/50"
      />
      <motion.div
        role="dialog"
        aria-label={`Delete ${title}`}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={springUI}
        className="fixed inset-x-0 bottom-0 z-[60] mx-auto max-w-2xl rounded-t-3xl bg-tile p-5 pb-[max(env(safe-area-inset-bottom),20px)]"
      >
        <h2 className="font-display text-xl font-bold">Delete {title}?</h2>
        <p className="mt-1 text-sm text-smoke">
          Its recipes are in your library too. Keep them, or let them go with the meal.
        </p>
        <div className="mt-4 space-y-2">
          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={springUI}
            onClick={() => onChoose(false)}
            className="w-full rounded-xl bg-char py-3.5 font-display font-bold text-tile"
          >
            Delete the meal, keep the recipes
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={springUI}
            onClick={() => onChoose(true)}
            className="w-full rounded-xl bg-flame py-3.5 font-display font-bold text-accent-ink"
          >
            Delete the meal and its {recipeCount} {recipeCount === 1 ? "recipe" : "recipes"}
          </motion.button>
          <button onClick={onClose} className="w-full py-3 text-sm font-semibold text-smoke">
            Cancel
          </button>
        </div>
      </motion.div>
    </>
  );
}
