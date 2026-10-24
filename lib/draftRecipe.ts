import type { Recipe } from "./types";
import type { Extraction } from "./schemas";

/**
 * An invented recipe has no row yet, but the detail sheet renders a Recipe.
 * These are the fields it reads; the rest are the neutral defaults a recipe
 * would have the instant after it was saved.
 */
export function draftRecipe(e: Extraction): Recipe {
  return {
    id: "draft",
    title: e.title,
    description: e.description,
    ingredients: e.ingredients,
    steps: e.steps,
    servings: e.servings,
    time_total_min: e.time_total_min,
    time_active_min: e.time_active_min,
    status: "want_to_try",
    hearts: null,
    effort: null,
    notes: "",
    tags: e.tags,
    cuisine: e.cuisine,
    course: e.course,
    season: e.season,
    occasion: e.occasion,
    main_ingredients: e.main_ingredients,
    source_url: null,
    source_name: e.source_name ?? "Night Kitchen",
    source_type: "manual",
    image_url: null,
    image_thumb_url: null,
    capture_status: "ready",
    capture_error: null,
    capture_gaps: e.gaps,
    possible_duplicate_of: null,
    created_at: "",
    updated_at: "",
  };
}
