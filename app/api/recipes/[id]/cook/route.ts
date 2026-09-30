import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/recipes/[id]/cook — "I made this"
 * Adds a cook_log entry, sets recipe status to 'made', updates hearts if given.
 */
export async function POST(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const supabase = db();

  // cook_log has no user_id of its own; it's scoped through its recipe, so verify
  // the recipe is the caller's before logging against it.
  const { data: owned } = await supabase
    .from("recipes").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: entry, error } = await supabase
    .from("cook_log")
    .insert({
      recipe_id: id,
      cooked_on: body.cooked_on ?? new Date().toISOString().slice(0, 10),
      note: body.note ?? "",
      hearts_at_time: body.hearts ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const recipePatch: Record<string, unknown> = { status: "made" };
  if (body.hearts) recipePatch.hearts = body.hearts;
  await supabase.from("recipes").update(recipePatch).eq("id", id).eq("user_id", userId);

  return NextResponse.json({ entry });
}
