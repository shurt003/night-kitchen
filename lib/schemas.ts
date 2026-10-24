import { z } from "zod";
import { COURSES, GROCERY_SECTIONS } from "./config";
import { normalizeGamePlan } from "./gamePlan";

export const IngredientSchema = z.object({
  raw: z.string(),
  quantity: z.string().nullable().default(null), // "2", "1/2", "2-3" — keep as text
  unit: z.string().nullable().default(null),
  item: z.string(),
  note: z.string().nullable().default(null),
  section: z.string().nullable().default(null), // "For the sauce" groupings
  // Weight in grams, shown beside the measured amount ("1¼ tsp (4 g)"). Make
  // fills it for baking; everything else leaves it null. .catch so a stray
  // non-number drops the weight rather than failing the whole recipe.
  grams: z.number().positive().nullable().catch(null).default(null),
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

/** Make, step one: the shape of the request, and whether servings need asking. */
export const MakeScopeSchema = z
  .object({
  kind: z.enum(["dish", "meal"]).catch("dish"),
  // Empty is allowed only for a week-shaped ask (checked below) — there's no
  // single meal to list. More than four is trimmed rather than refused.
  dishes: z
    .array(z.object({ title: z.string(), course: z.enum(COURSES).catch("misc").default("misc") }))
    .default([])
    .transform((d) => d.slice(0, 4)),
  servings_in_request: z.number().int().positive().nullable().default(null),
  // A batch with no number ("one big pot", servings null) can't be cooked
  // for, so it drops to null and the cook is asked for servings instead of
  // the whole read failing.
  standard_yield: z
    .object({ servings: z.number().int().positive(), label: z.string() })
    .nullable()
    .catch(null)
    .default(null),
  not_food: z.boolean().default(false),
  /** Dinners across several nights — better as Plan the week than one meal. */
  week_shaped: z.boolean().catch(false).default(false),
  nights_in_request: z.number().int().positive().nullable().catch(null).default(null),
  })
  .refine((v) => v.week_shaped || v.dishes.length > 0, { message: "No dishes", path: ["dishes"] });
export type MakeScope = z.infer<typeof MakeScopeSchema>;

/**
 * A meal's game plan. Structured steps, but plain "2 hours before: …" strings
 * are accepted too and normalized, so a slip in format costs nothing.
 */
const GamePlanSchema = z
  .array(z.unknown())
  .nullable()
  .default(null)
  .transform((v) => normalizeGamePlan(v));

/** Make, step two: one recipe, or a meal's recipes plus the order to cook them. */
export const MakeRecipeSchema = z.object({
  /** What a saved meal is called until the cook renames it. Null for one dish. */
  meal_title: z.string().trim().max(120).nullable().catch(null).default(null),
  dishes: z.array(ExtractionSchema).min(1).max(4),
  game_plan: GamePlanSchema,
});
export type MakeResult = z.infer<typeof MakeRecipeSchema>;

/** Swapping one dish of a meal: the new dish and the plan rewritten around it. */
export const MakeSwapSchema = z.object({
  dish: ExtractionSchema,
  game_plan: GamePlanSchema,
});

/** Plan the week, step one: the outline every recipe is then written against. */
export const WeekOutlineSchema = z.object({
  title: z.string().trim().min(1).max(120),
  components: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        title: z.string().trim().min(1),
        makes: z.string().default(""),
        used_on: z.array(z.number().int().positive()).default([]),
        prep_day: z.string().nullable().catch(null).default(null),
      })
    )
    .max(5)
    .default([]),
  nights: z
    .array(
      z.object({
        night: z.number().int().positive(),
        label: z.string().default(""),
        title: z.string().trim().min(1),
        hook: z.string().default(""),
        uses: z.array(z.string()).default([]),
        tonight_min: z.number().int().nonnegative().nullable().catch(null).default(null),
        kind: z.enum(["cook", "remix", "reheat"]).catch("cook").default("cook"),
        from_night: z.number().int().positive().nullable().catch(null).default(null),
      })
    )
    .min(1)
    .max(7),
  /** One bulk-cooking session per prep day (day null when there's no prep day). */
  prep_sessions: z
    .array(z.object({ day: z.string().nullable().catch(null).default(null), plan: GamePlanSchema.transform((p) => p ?? []) }))
    .default([]),
  /** The prep days the cook chose, set by the route — not the model. */
  prep_days: z.array(z.string()).default([]),
  // Older saved weeks: one session, one prep day.
  prep_plan: GamePlanSchema,
  prep_day: z.string().nullable().catch(null).default(null),
});

/** Swapping one night of a week: its new outline entry and (unless it's a reheat) its recipe. */
export const WeekSwapSchema = z.object({
  night: WeekOutlineSchema.shape.nights.element,
  recipe: ExtractionSchema.nullable().default(null),
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
