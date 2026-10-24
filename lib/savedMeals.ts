import { db } from "./db";
import type { Recipe } from "./types";
import type { GamePlanStep } from "./gamePlan";
import { normalizeGamePlan } from "./gamePlan";

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
  dishes: { id: string; night: number; position: number; note: string | null; recipe: Recipe }[];
};

type Row = Omit<SavedMeal, "dishes" | "game_plan"> & {
  game_plan: unknown;
  saved_meal_dishes: {
    id: string;
    night: number;
    position: number;
    note: string | null;
    recipe: Recipe | null;
  }[];
};

const SELECT =
  "id, title, request, servings, game_plan, serve_time, kind, created_at, saved_meal_dishes(id, night, position, note, recipe:recipes(*))";

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

/** Replace a meal's dishes with these recipes, in this order (all on night 1). */
export async function setMealDishes(mealId: string, recipeIds: string[]) {
  const supabase = db();
  const { error: delError } = await supabase.from("saved_meal_dishes").delete().eq("meal_id", mealId);
  if (delError) throw new Error(delError.message);
  const rows = recipeIds.map((recipe_id, position) => ({ meal_id: mealId, recipe_id, position, night: 1 }));
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
