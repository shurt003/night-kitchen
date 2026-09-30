import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/** PATCH — move a night (drag to rearrange), lock it, or edit its note. */
export async function PATCH(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.date === "string") patch.date = body.date;
  if (typeof body.locked === "boolean") patch.locked = body.locked;
  if (typeof body.note === "string") patch.note = body.note;
  if (typeof body.title === "string") patch.title = body.title;
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await db()
    .from("planned_meals")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select(
      "*, recipes(id, title, image_url, time_active_min, effort, hearts, ingredients), quick_meals(id, name, ingredients)"
    )
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ meal: data });
}

/**
 * DELETE /api/planner/[id]?pull_items=1
 * Removing a meal offers to pull its unchecked items back out of the open trip.
 * Manual items are never touched — only items whose source is this meal.
 */
export async function DELETE(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const pull = new URL(req.url).searchParams.get("pull_items") === "1";
  const supabase = db();

  const { data: meal } = await supabase
    .from("planned_meals")
    .select("id, recipe_id, quick_meal_id, source_type")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  let removed = 0;
  if (pull && meal) {
    const sourceId = meal.recipe_id ?? meal.quick_meal_id ?? meal.id;
    const { data: gone } = await supabase
      .from("grocery_items")
      .delete()
      .eq("user_id", userId)
      .eq("source_id", sourceId)
      .eq("checked", false)
      .neq("source_type", "manual")
      .select("id");
    removed = gone?.length ?? 0;
  }

  const { error } = await supabase.from("planned_meals").delete().eq("id", id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, removed_items: removed });
}
