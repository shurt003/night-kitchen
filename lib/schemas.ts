import { z } from "zod";
import { COURSES, GROCERY_SECTIONS } from "./config";

export const IngredientSchema = z.object({
  raw: z.string(),
  quantity: z.string().nullable().default(null), // "2", "1/2", "2-3" — keep as text
  unit: z.string().nullable().default(null),
  item: z.string(),
  note: z.string().nullable().default(null),
  section: z.string().nullable().default(null), // "For the sauce" groupings
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const StepSchema = z.object({
  text: z.string(),
  timer_seconds: z.number().int().nullable().default(null),
});
export type Step = z.infer<typeof StepSchema>;

export const ExtractionSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  ingredients: z.array(IngredientSchema).default([]),
  steps: z.array(StepSchema).default([]),
  servings: z.number().int().nullable().default(null),
  time_total_min: z.number().int().nullable().default(null),
  time_active_min: z.number().int().nullable().default(null),
  tags: z.array(z.string()).default([]),
  cuisine: z.string().nullable().default(null),
  // .catch keeps a bad classification from failing the whole extraction — an
  // off-vocab value lands in misc rather than throwing.
  course: z.enum(COURSES).catch("misc").default("misc"),
  season: z.array(z.string()).default([]),
  occasion: z.array(z.string()).default([]),
  main_ingredients: z.array(z.string()).default([]),
  image_url: z.string().nullable().default(null),
  source_name: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(1),
  gaps: z.array(z.string()).default([]),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const CategorizeSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      canonical: z.string(),
      section: z.enum(GROCERY_SECTIONS),
    })
  ),
});

export const DuplicateSchema = z.object({
  duplicate_id: z.string().nullable().default(null),
});

export const PlanSchema = z.object({
  picks: z.array(
    z.object({
      date: z.string(),
      // Ranked: options[0] is the primary suggestion, the rest are alternates
      // shown when the user taps "something else" — no second model call.
      options: z
        .array(
          z.object({
            // "idea" = invented from what's on hand, not a saved recipe.
            source_type: z.enum(["recipe", "quick_meal", "idea"]),
            id: z.string().nullable().default(null), // recipe/quick_meal only
            title: z.string().nullable().default(null), // idea only
            time_active_min: z.number().int().nullable().default(null), // idea only
            uses: z.array(z.string()).default([]), // idea: on-hand items it leans on
            needs: z.array(z.string()).default([]), // idea: what you'd buy
            ingredients: z
              .array(
                z.object({
                  item: z.string(),
                  quantity: z.string().nullable().default(null),
                })
              )
              .default([]), // idea: full list, for add-to-grocery later
            reason: z.string().default(""),
          })
        )
        .min(1),
    })
  ),
});

export const PantrySchema = z.object({
  can_make_now: z
    .array(z.object({ id: z.string(), reason: z.string().default("") }))
    .default([]),
  nearly: z
    .array(
      z.object({
        id: z.string(),
        missing: z.array(z.string()).default([]),
        reason: z.string().default(""),
      })
    )
    .default([]),
});

/**
 * Pitches, not recipes — deliberately cheap. The full recipe is generated only
 * for the card you actually tap, so two thirds of these are never expanded.
 */
export const InventPitchesSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string(),
        hook: z.string().default(""),
        time_total_min: z.number().int().nullable().default(null),
        time_active_min: z.number().int().nullable().default(null),
        /** What of theirs it leans on — shown as the "uses" line. */
        uses: z.array(z.string()).default([]),
        /**
         * The starch or side that makes it a meal, when the title doesn't
         * already say it. Null when the dish stands alone. Carried as a field
         * rather than left to the title, which used to drop it silently.
         */
        serve_with: z.string().nullable().default(null),
        cuisine: z.string().nullable().default(null),
      })
    )
    .default([]),
});

export const SubstituteSchema = z.object({
  suggestions: z
    .array(z.object({ swap: z.string(), note: z.string().default("") }))
    .default([]),
});

/** A condensed Ask answer, ready to scribble into a recipe's notes. */
export const RecipeNoteSchema = z.object({
  note: z.string(),
});
