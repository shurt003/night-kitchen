import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { updateEmbedding } from "@/lib/extract";
import { currentUserId } from "@/lib/auth";

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
  return NextResponse.json({ recipe: data });
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
  const supabase = db();

  // Verify ownership before touching Storage, so a non-owner can't delete files.
  const { data: owned } = await supabase
    .from("recipes").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: files } = await supabase.storage.from("captures").list(id);
  if (files?.length) {
    await supabase.storage.from("captures").remove(files.map((f) => `${id}/${f.name}`));
  }

  const { error } = await supabase.from("recipes").delete().eq("id", id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
