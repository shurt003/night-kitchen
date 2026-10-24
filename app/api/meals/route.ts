import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";
import { getMeal, listMeals, ownsRecipes, setMealDishes } from "@/lib/savedMeals";

/** GET /api/meals — every saved meal, newest first, with its dishes. */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ meals: await listMeals(userId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const MealBody = z.object({
  title: z.string().trim().min(1).max(120),
  request: z.string().trim().max(500).nullable().default(null),
  servings: z.number().int().positive().max(50).nullable().default(null),
  game_plan: z.array(z.unknown()).nullable().default(null),
  serve_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  recipe_ids: z.array(z.string().uuid()).min(1).max(8),
});

/**
 * POST /api/meals — keep a Make meal together. The dishes are saved first (as
 * ordinary recipes); this records that they belong together, in order, with
 * the game plan.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = MealBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "That isn't a meal." }, { status: 400 });
  const m = parsed.data;
  if (!(await ownsRecipes(userId, m.recipe_ids))) {
    return NextResponse.json({ error: "Save the dishes first." }, { status: 400 });
  }

  const { data, error } = await db()
    .from("saved_meals")
    .insert({
      user_id: userId,
      title: m.title,
      request: m.request,
      servings: m.servings,
      game_plan: m.game_plan ?? [],
      serve_time: m.serve_time,
      kind: "meal",
    })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't save." }, { status: 500 });

  try {
    await setMealDishes(data.id, m.recipe_ids);
  } catch (e) {
    // Don't leave an empty meal behind.
    await db().from("saved_meals").delete().eq("id", data.id);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ meal: await getMeal(userId, data.id) });
}
