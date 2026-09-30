import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";

/**
 * GET /api/export — the whole library as one JSON blob.
 * Never be trapped in your own app; a backup that isn't "hope Supabase is fine".
 */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = db();

  const { data: recipeRows } = await supabase
    .from("recipes").select("*").eq("user_id", userId).order("created_at");
  const recipeIds = (recipeRows ?? []).map((r) => r.id);

  const [cookLog, quickMeals, plannedMeals, trips, items, staples, prefs, aliases] =
    await Promise.all([
      // cook_log has no user_id of its own — scope it through the user's recipes.
      recipeIds.length
        ? supabase.from("cook_log").select("*").in("recipe_id", recipeIds).order("cooked_on")
        : Promise.resolve({ data: [] as unknown[] }),
      supabase.from("quick_meals").select("*").eq("user_id", userId),
      supabase.from("planned_meals").select("*").eq("user_id", userId).order("date"),
      supabase.from("grocery_trips").select("*").eq("user_id", userId).order("shop_date"),
      supabase.from("grocery_items").select("*").eq("user_id", userId),
      supabase.from("staples").select("*").eq("user_id", userId),
      // Shared reference caches (no private content).
      supabase.from("item_section_prefs").select("*"),
      supabase.from("ingredient_aliases").select("*"),
    ]);
  const recipes = { data: recipeRows };

  const body = {
    exported_at: new Date().toISOString(),
    version: 1,
    recipes: recipes.data ?? [],
    cook_log: cookLog.data ?? [],
    quick_meals: quickMeals.data ?? [],
    planned_meals: plannedMeals.data ?? [],
    grocery_trips: trips.data ?? [],
    grocery_items: items.data ?? [],
    staples: staples.data ?? [],
    item_section_prefs: prefs.data ?? [],
    ingredient_aliases: aliases.data ?? [],
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="night-kitchen-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
