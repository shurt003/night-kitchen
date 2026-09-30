import type { Ingredient, Step } from "./schemas";
import type { GrocerySection } from "./config";

export type Recipe = {
  id: string;
  title: string;
  description: string;
  ingredients: Ingredient[];
  steps: Step[];
  servings: number | null;
  time_total_min: number | null;
  time_active_min: number | null;
  status: "want_to_try" | "made" | "retired";
  hearts: number | null;
  effort: number | null;
  notes: string;
  tags: string[];
  cuisine: string | null;
  course: string | null;
  season: string[];
  occasion: string[];
  main_ingredients: string[];
  source_url: string | null;
  source_name: string | null;
  source_type: "url" | "images" | "pdf" | "manual";
  image_url: string | null;
  /** Tiny square (320px webp) for list avatars; null on recipes captured before thumbs. */
  image_thumb_url: string | null;
  capture_status: "pending" | "processing" | "ready" | "failed";
  capture_error: string | null;
  capture_gaps: string[];
  possible_duplicate_of: string | null;
  created_at: string;
  updated_at: string;
  // list endpoint extras
  times_cooked?: number;
  last_cooked?: string | null;
  // detail endpoint extras
  cook_log?: CookLogEntry[];
};

export type CookLogEntry = {
  id: string;
  cooked_on: string;
  note: string;
  hearts_at_time: number | null;
};

export type QuickMeal = {
  id: string;
  name: string;
  ingredients: Ingredient[];
  times_used: number;
  last_used: string | null;
};

export type Staple = {
  id: string;
  name: string;
  section: GrocerySection;
  typical_cadence_days: number | null;
  last_added: string | null;
  active: boolean;
  due_in_days?: number | null;
  overdue?: boolean;
};

export type PlannedMeal = {
  id: string;
  date: string;
  slot: "dinner";
  source_type: "recipe" | "quick_meal" | "freeform";
  recipe_id: string | null;
  quick_meal_id: string | null;
  title: string;
  ingredients: Ingredient[] | null;
  note: string;
  reason: string;
  locked: boolean;
  recipes?: {
    id: string;
    title: string;
    image_url: string | null;
    time_active_min: number | null;
    effort: number | null;
    hearts: number | null;
    ingredients: Ingredient[];
  } | null;
  quick_meals?: { id: string; name: string; ingredients: Ingredient[] } | null;
};

/** What a slot should display, whatever kind of meal fills it. */
export function mealLabel(m: PlannedMeal): string {
  return m.recipes?.title ?? m.quick_meals?.name ?? (m.title || "Dinner");
}

/**
 * A planned night that deliberately isn't cooking — leftovers, takeout, out.
 * These are freeform rows with a canonical title (the picker's one-tap chips
 * create exactly these), rendered muted so a full week reads calm, and passed
 * to the planner as real context. Typing "leftovers" by hand counts too.
 */
export const NO_COOK_TITLES = ["Leftovers", "Takeout", "Eating out"] as const;

export function isNoCook(m: PlannedMeal): boolean {
  if (m.source_type !== "freeform" || m.recipes || m.quick_meals) return false;
  const t = m.title.trim().toLowerCase();
  return NO_COOK_TITLES.some((c) => c.toLowerCase() === t);
}

export type GroceryTrip = {
  id: string;
  shop_date: string;
  status: "open" | "archived";
};

export type GroceryItem = {
  id: string;
  trip_id: string;
  name: string;
  canonical_name: string | null;
  quantity: string;
  section: GrocerySection;
  checked: boolean;
  source_type: "manual" | "recipe" | "quick_meal" | "staple" | "ai";
  source_id: string | null;
  sources: { type: string; id: string | null; label: string | null; quantity: string }[];
  carried_over_from: string | null;
  created_at: string;
};
