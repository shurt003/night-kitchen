import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";
import { deleteRecipeFully, getMeal, ownsRecipes, setMealDishes } from "@/lib/savedMeals";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const meal = await getMeal(userId, id);
  if (!meal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ meal });
}

const Patch = z
  .object({
    title: z.string().trim().min(1).max(120),
    servings: z.number().int().positive().max(50).nullable(),
    game_plan: z.array(z.unknown()).nullable(),
    // "" or null clears it.
    serve_time: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal(""), z.null()]),
    // After a swap: the meal's dishes, in order.
    recipe_ids: z.array(z.string().uuid()).min(1).max(8),
  })
  .partial();

/** PATCH /api/meals/[id] — rename, set dinner time, or take a swapped dish. */
export async function PATCH(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  const p = parsed.data;

  const { data: owned } = await db()
    .from("saved_meals").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.title !== undefined) fields.title = p.title;
  if (p.servings !== undefined) fields.servings = p.servings;
  if (p.game_plan !== undefined) fields.game_plan = p.game_plan ?? [];
  if (p.serve_time !== undefined) fields.serve_time = p.serve_time || null;
  const { error } = await db().from("saved_meals").update(fields).eq("id", id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (p.recipe_ids) {
    if (!(await ownsRecipes(userId, p.recipe_ids))) {
      return NextResponse.json({ error: "Save the dishes first." }, { status: 400 });
    }
    await setMealDishes(id, p.recipe_ids);
  }
  return NextResponse.json({ meal: await getMeal(userId, id) });
}

/**
 * DELETE /api/meals/[id] — the grouping only, or (?with_recipes=1) the
 * grouping and every recipe in it, files and all. The page holds this back
 * until its undo window closes, so undo never has anything to restore.
 */
export async function DELETE(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const meal = await getMeal(userId, id);
  if (!meal) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const withRecipes = new URL(req.url).searchParams.get("with_recipes") === "1";
  const { error } = await db().from("saved_meals").delete().eq("id", id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (withRecipes) {
    // One recipe can sit in a meal twice (cook once, eat twice) — delete each once.
    for (const recipeId of new Set(meal.dishes.map((d) => d.recipe.id))) {
      await deleteRecipeFully(userId, recipeId);
    }
  }
  return NextResponse.json({ ok: true });
}
