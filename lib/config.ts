// All model IDs live here so they can be swapped in one place.

export const MODELS = {
  /** Extraction, tagging, duplicate checks, shopping-list categorization */
  fast: "claude-haiku-4-5",
  /** Meal planning, suggestions, pantry matching, chat */
  smart: "claude-sonnet-5",
} as const;

/** Voyage AI embedding model — 1024 dims, must match vector(1024) in the schema */
export const EMBEDDING_MODEL = "voyage-3.5-lite";

/**
 * Recipe course, for the Library filter pills. "misc" is the catch-all — a
 * recipe that fits none of the others lands here, so nothing is unclassifiable.
 * "All" is a UI state, not a stored value. Plain strings, not a DB enum, so this
 * list can change without a migration (see 003_recipe_course.sql).
 */
export const COURSES = ["meals", "appetizers", "sides", "desserts", "drinks", "misc"] as const;
export type Course = (typeof COURSES)[number];
export const COURSE_LABELS: Record<Course, string> = {
  meals: "Meals",
  appetizers: "Appetizers",
  sides: "Sides",
  desserts: "Desserts",
  drinks: "Drinks",
  misc: "Misc",
};

export const GROCERY_SECTIONS = [
  "produce",
  "meat_fish",
  "dairy",
  "pantry",
  "frozen",
  "bakery",
  "household",
  "other",
] as const;

export type GrocerySection = (typeof GROCERY_SECTIONS)[number];

export const SECTION_LABELS: Record<GrocerySection, string> = {
  produce: "Produce",
  meat_fish: "Meat + Fish",
  dairy: "Dairy",
  pantry: "Pantry",
  frozen: "Frozen",
  bakery: "Bakery",
  household: "Household",
  other: "Other",
};
