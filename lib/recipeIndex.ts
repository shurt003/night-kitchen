import { db } from "./db";

/**
 * The compact index sent to planning/pantry/chat features.
 * Spec §6: never send full recipe bodies — a 200-recipe index is small and
 * keeps these calls cheap and fast.
 */
export type RecipeIndexEntry = {
  id: string;
  title: string;
  tags: string[];
  main_ingredients: string[];
  time_active: number | null;
  hearts: number | null;
  effort: number | null;
  status: string;
  cuisine: string | null;
  last_cooked: string | null;
  times_cooked: number;
  notes?: string;
};

export async function buildRecipeIndex(
  userId: string,
  opts: { includeNotes?: boolean } = {}
): Promise<RecipeIndexEntry[]> {
  const supabase = db();
  const { data } = await supabase
    .from("recipes")
    .select(
      "id, title, tags, main_ingredients, time_active_min, hearts, effort, status, cuisine, notes, cook_log(cooked_on)"
    )
    .eq("user_id", userId)
    .eq("capture_status", "ready")
    .neq("status", "retired")
    .limit(500);

  type Row = {
    id: string;
    title: string;
    tags: string[] | null;
    main_ingredients: string[] | null;
    time_active_min: number | null;
    hearts: number | null;
    effort: number | null;
    status: string;
    cuisine: string | null;
    notes: string | null;
    cook_log?: { cooked_on: string }[];
  };

  return ((data ?? []) as Row[]).map((r) => {
    const cooks = (r.cook_log ?? []).map((c) => c.cooked_on).sort();
    const entry: RecipeIndexEntry = {
      id: r.id,
      title: r.title,
      tags: r.tags ?? [],
      main_ingredients: r.main_ingredients ?? [],
      time_active: r.time_active_min,
      hearts: r.hearts,
      effort: r.effort,
      status: r.status,
      cuisine: r.cuisine,
      last_cooked: cooks.at(-1) ?? null,
      times_cooked: cooks.length,
    };
    if (opts.includeNotes && r.notes) entry.notes = r.notes.slice(0, 400);
    return entry;
  });
}

/** Quick meals are valid planner picks alongside recipes. */
export async function buildQuickMealIndex(userId: string) {
  const { data } = await db()
    .from("quick_meals")
    .select("id, name, times_used, last_used")
    .eq("user_id", userId)
    .order("times_used", { ascending: false })
    .limit(100);
  return data ?? [];
}
