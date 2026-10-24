"use client";

import { motion } from "motion/react";
import type { SavedMeal } from "@/lib/savedMeals";
import { springOvershoot } from "@/lib/springs";
import { RecipeImage } from "./RecipeImage";

/**
 * A saved meal in the Library: one wide card, so it reads as a set rather than
 * another recipe tile. The main dish's photo leads once there is one.
 */
export function MealCard({ meal, onOpen }: { meal: SavedMeal; onOpen: (m: SavedMeal) => void }) {
  const main = meal.dishes.find((d) => d.recipe.course === "meals") ?? meal.dishes[0];
  const photo = meal.dishes.map((d) => d.recipe.image_thumb_url ?? d.recipe.image_url).find(Boolean) ??
    null;
  const mainPhoto = main?.recipe.image_thumb_url ?? main?.recipe.image_url ?? photo;
  const count = meal.dishes.length;
  // A week reads by its nights ("5 nights · 7 recipes"); a meal by its dishes.
  const week = meal.kind === "nights" ? meal.week : null;

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={springOvershoot}
      onClick={() => onOpen(meal)}
      className="flex w-full gap-3 overflow-hidden rounded-[14px] border border-char/10 bg-surface p-2.5 text-left"
    >
      <span className="relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-[10px] bg-char/5">
        {mainPhoto ? (
          <RecipeImage src={mainPhoto} />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-yolk/30 to-flame/20 font-display text-2xl font-bold text-char/30">
            {meal.title.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block font-display text-[15px] font-bold leading-snug">{meal.title}</span>
        <span className="mt-0.5 line-clamp-2 text-xs text-smoke">
          {week
            ? week.nights.map((n) => n.title).join(" · ")
            : meal.dishes.map((d) => d.recipe.title).join(" · ")}
        </span>
        <span className="mt-1 block text-xs font-semibold text-char/50">
          {week
            ? `${week.nights.length} nights · ${count} ${count === 1 ? "recipe" : "recipes"}`
            : `${count} ${count === 1 ? "dish" : "dishes"}${meal.servings ? ` · serves ${meal.servings}` : ""}`}
        </span>
      </span>
    </motion.button>
  );
}
