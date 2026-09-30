import { db } from "./db";
import { normalizeName } from "./groceryShared";
import type { Ingredient } from "./schemas";

/** One line that would land on the grocery list, with its provenance intact. */
export type Candidate = {
  name: string;
  quantity: string;
  source_type: "recipe" | "quick_meal" | "manual";
  source_id: string | null;
  source_label: string | null;
};

export type AnnotatedCandidate = Candidate & {
  likely_owned: boolean;
  reason: string | null;
};

function toCandidates(
  ingredients: Ingredient[],
  source: Candidate["source_type"],
  sourceId: string | null,
  label: string | null
): Candidate[] {
  return ingredients
    .filter((ing) => (ing.item || ing.raw)?.trim())
    .map((ing) => ({
      name: ing.item || ing.raw,
      quantity: [ing.quantity, ing.unit].filter(Boolean).join(" "),
      source_type: source,
      source_id: sourceId,
      source_label: label,
    }));
}

export async function candidatesForRecipe(userId: string, recipeId: string): Promise<Candidate[]> {
  const { data } = await db()
    .from("recipes")
    .select("id, title, ingredients")
    .eq("id", recipeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return [];
  return toCandidates(data.ingredients as Ingredient[], "recipe", data.id, data.title);
}

export async function candidatesForPlannedMeal(userId: string, mealId: string): Promise<Candidate[]> {
  const { data: meal } = await db()
    .from("planned_meals")
    .select("*, recipes(id, title, ingredients), quick_meals(id, name, ingredients)")
    .eq("id", mealId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!meal) return [];

  const recipe = meal.recipes as { id: string; title: string; ingredients: Ingredient[] } | null;
  const quick = meal.quick_meals as { id: string; name: string; ingredients: Ingredient[] } | null;
  const ingredients: Ingredient[] =
    recipe?.ingredients ?? quick?.ingredients ?? (meal.ingredients as Ingredient[]) ?? [];

  return toCandidates(
    ingredients,
    recipe ? "recipe" : quick ? "quick_meal" : "manual",
    recipe?.id ?? quick?.id ?? meal.id,
    recipe?.title ?? quick?.name ?? meal.title
  );
}

// ---------------------------------------------------------------------------
// "You probably already have this"
//
// Matched against staples only — deliberately not a tracked inventory, because
// an inventory nobody updates drifts toward silently withholding things you
// actually need. Staples are set once and stay true, so they're safe to lean on.
//
// No model call here: this runs while the user waits, and the alias cache plus
// whole-word matching is accurate enough for the pantry-shelf items involved.
// ---------------------------------------------------------------------------

/**
 * Just enough stemming to fold plurals, so an "eggs" staple matches an "egg"
 * ingredient. Deliberately conservative — over-stemming would create false
 * "you already have this" matches, which is the expensive direction to be wrong.
 */
function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (/(oes|ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function words(s: string): string[] {
  return normalizeName(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem);
}

export async function annotateOwned(userId: string, candidates: Candidate[]): Promise<AnnotatedCandidate[]> {
  const supabase = db();
  const { data: staples } = await supabase
    .from("staples")
    .select("name")
    .eq("user_id", userId)
    .eq("active", true);

  if (!staples?.length) {
    return candidates.map((c) => ({ ...c, likely_owned: false, reason: null }));
  }

  // Fold in known aliases so "scallions" matches a "green onions" staple.
  const names = [
    ...candidates.map((c) => normalizeName(c.name)),
    ...staples.map((s) => normalizeName(s.name)),
  ];
  const { data: aliases } = await supabase
    .from("ingredient_aliases")
    .select("raw_name, canonical")
    .in("raw_name", [...new Set(names)]);
  const canonicalOf = new Map((aliases ?? []).map((a) => [a.raw_name, a.canonical as string]));
  const canon = (s: string) => canonicalOf.get(normalizeName(s)) ?? normalizeName(s);

  return candidates.map((c) => {
    const ingredientWords = new Set(words(canon(c.name)));
    const match = staples.find((s) => {
      const stapleCanon = canon(s.name);
      if (stapleCanon === canon(c.name)) return true;
      // Whole words only: "olive oil" should match "extra-virgin olive oil",
      // but "salt" must not match "salted butter".
      const stapleWords = words(stapleCanon);
      return stapleWords.length > 0 && stapleWords.every((w) => ingredientWords.has(w));
    });
    return {
      ...c,
      likely_owned: !!match,
      reason: match ? `you keep ${match.name} stocked` : null,
    };
  });
}
