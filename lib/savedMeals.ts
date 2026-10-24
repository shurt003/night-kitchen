import { db } from "./db";
import type { Recipe } from "./types";
import type { GamePlanStep } from "./gamePlan";
import { normalizeGamePlan } from "./gamePlan";
import type { WeekOutline } from "./weekPlan";

/**
 * A Make meal kept together: its dishes (ordinary recipes), its game plan and,
 * optionally, what time dinner is. `kind` is "meal" for now; "nights" is the
 * multi-night plan to come (docs/MAKE_PLAN.md, Phase 2.6).
 */
export type SavedMeal = {
  id: string;
  title: string;
  request: string | null;
  servings: number | null;
  game_plan: GamePlanStep[] | null;
  serve_time: string | null;
  kind: "meal" | "nights";
  created_at: string;
  /**
   * For a planned week: the outline it was written from (components, nights,
   * prep session). Null for a single meal. Dishes on night 0 are the prep
   * components (their `note` is the component key); nights 1..n are dinners.
   */
  week: WeekOutline | null;
  dishes: { id: string; night: number; position: number; note: string | null; recipe: Recipe }[];
};

/** One dish of a saved meal: which recipe, on which night (0 = prep), with an optional note. */
export type MealDishInput = { recipe_id: string; night: number; note?: string | null };

type Row = Omit<SavedMeal, "dishes" | "game_plan" | "week"> & {
  game_plan: unknown;
  nights: unknown;
  saved_meal_dishes: {
    id: string;
    night: number;
    position: number;
    note: string | null;
    recipe: Recipe | null;
  }[];
};

const SELECT =
  "id, title, request, servings, game_plan, serve_time, kind, nights, created_at, saved_meal_dishes(id, night, position, note, recipe:recipes(*))";

function shape(row: Row): SavedMeal {
  const dishes = (row.saved_meal_dishes ?? [])
    // A recipe deleted elsewhere cascades its row away, but guard anyway.
    .filter((d): d is typeof d & { recipe: Recipe } => !!d.recipe)
    .sort((a, b) => a.night - b.night || a.position - b.position);
  return {
    id: row.id,
    title: row.title,
    request: row.request,
    servings: row.servings,
    game_plan: normalizeGamePlan(row.game_plan),
    // Postgres time comes back "19:00:00"; the page works in "19:00".
    serve_time: row.serve_time ? row.serve_time.slice(0, 5) : null,
    kind: row.kind,
    created_at: row.created_at,
    // A week keeps its outline in `nights` (an object); a meal leaves it [].
    week:
      row.kind === "nights" && row.nights && typeof row.nights === "object" && !Array.isArray(row.nights)
        ? (row.nights as WeekOutline)
        : null,
    dishes,
  };
}

/** Every saved meal of this user's, newest first. */
export async function listMeals(userId: string): Promise<SavedMeal[]> {
  const { data, error } = await db()
    .from("saved_meals")
    .select(SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Row[]).map(shape);
}

export async function getMeal(userId: string, id: string): Promise<SavedMeal | null> {
  const { data, error } = await db()
    .from("saved_meals")
    .select(SELECT)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? shape(data as unknown as Row) : null;
}

/** True only if every id is a recipe this user owns — no borrowing someone else's. */
export async function ownsRecipes(userId: string, ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const unique = [...new Set(ids)];
  const { data } = await db().from("recipes").select("id").eq("user_id", userId).in("id", unique);
  return (data ?? []).length === unique.length;
}

/**
 * Replace a meal's dishes. Plain recipe ids are a single meal, in order, all on
 * night 1; a week passes each dish's night (0 = prep) and note. Position counts
 * up within each night.
 */
export async function setMealDishes(mealId: string, dishes: string[] | MealDishInput[]) {
  const supabase = db();
  const { error: delError } = await supabase.from("saved_meal_dishes").delete().eq("meal_id", mealId);
  if (delError) throw new Error(delError.message);
  const list: MealDishInput[] = dishes.map((d) => (typeof d === "string" ? { recipe_id: d, night: 1 } : d));
  const perNight = new Map<number, number>();
  const rows = list.map((d) => {
    const position = perNight.get(d.night) ?? 0;
    perNight.set(d.night, position + 1);
    return { meal_id: mealId, recipe_id: d.recipe_id, night: d.night, position, note: d.note ?? null };
  });
  const { error } = await supabase.from("saved_meal_dishes").insert(rows);
  if (error) throw new Error(error.message);
}

/**
 * Really delete one recipe: its stored files (hero, screenshots, PDF) and the
 * row (cook log and meal membership cascade). Ownership is checked first, so
 * nobody can remove another user's files. Shared by the recipe route and a
 * meal deleted together with its recipes.
 */
export async function deleteRecipeFully(userId: string, id: string): Promise<"ok" | "not_found"> {
  const supabase = db();
  const { data: owned } = await supabase
    .from("recipes").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!owned) return "not_found";

  const { data: files } = await supabase.storage.from("captures").list(id);
  if (files?.length) {
    await supabase.storage.from("captures").remove(files.map((f) => `${id}/${f.name}`));
  }
  const { error } = await supabase.from("recipes").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return "ok";
}

/** The saved meals a recipe belongs to — for its "Part of" link. */
export async function mealsForRecipe(userId: string, recipeId: string): Promise<{ id: string; title: string }[]> {
  const { data, error } = await db()
    .from("saved_meal_dishes")
    .select("saved_meals!inner(id, title, user_id)")
    .eq("recipe_id", recipeId)
    .eq("saved_meals.user_id", userId);
  // Before the meals migration runs this table doesn't exist — no link, no error.
  if (error || !data) return [];
  const seen = new Map<string, string>();
  for (const row of data as unknown as { saved_meals: { id: string; title: string } }[]) {
    seen.set(row.saved_meals.id, row.saved_meals.title);
  }
  return [...seen].map(([id, title]) => ({ id, title }));
}
