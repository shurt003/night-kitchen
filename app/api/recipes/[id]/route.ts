import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { updateEmbedding } from "@/lib/extract";
import { currentUserId } from "@/lib/auth";
import { deleteRecipeFully, mealsForRecipe } from "@/lib/savedMeals";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { data, error } = await db()
    .from("recipes")
    .select("*, cook_log(id, cooked_on, note, hearts_at_time)")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Which saved meals it's part of, for the "Part of" link on the recipe.
  return NextResponse.json({ recipe: data, part_of: await mealsForRecipe(userId, id) });
}

const EDITABLE = new Set([
  "title", "description", "ingredients", "steps", "servings", "time_total_min",
  "time_active_min", "status", "hearts", "effort", "notes", "tags", "cuisine",
  "course", "season", "occasion", "main_ingredients", "image_url", "possible_duplicate_of",
]);

export async function PATCH(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE.has(k)) patch[k] = v;
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }
  const { data, error } = await db()
    .from("recipes")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notes/title/tags feed semantic search — refresh the embedding after responding.
  if ("notes" in patch || "title" in patch || "tags" in patch || "description" in patch) {
    after(async () => updateEmbedding(id));
  }
  return NextResponse.json({ recipe: data });
}

/**
 * Really deletes: the row (cook_log cascades) and every stored file for this
 * recipe — hero image, screenshots, PDF. Nothing is left orphaned in Storage.
 */
export async function DELETE(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const result = await deleteRecipeFully(userId, id);
    if (result === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
