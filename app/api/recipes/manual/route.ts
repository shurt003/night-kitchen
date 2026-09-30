import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ExtractionSchema } from "@/lib/schemas";
import { currentUserId } from "@/lib/auth";

/**
 * POST /api/recipes/manual — save a recipe that didn't come from a capture.
 *
 * Today that means an invented one. The body is an Extraction, so the field
 * mapping is the same one runExtraction applies at the end of a capture — the
 * row lands "ready" with no pending_captures entry, because there is nothing
 * to extract and nothing to retry.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = ExtractionSchema.safeParse(body.recipe);
  if (!parsed.success) {
    return NextResponse.json({ error: "That isn't a recipe." }, { status: 400 });
  }
  const r = parsed.data;

  // The `generated` tag is what the card and the library filter key off. Without
  // it an invented recipe is indistinguishable from one you vouched for by
  // saving it, and the library stops meaning "things worth cooking".
  const tags = r.tags.includes("generated") ? r.tags : ["generated", ...r.tags];

  const { data: recipe, error } = await db()
    .from("recipes")
    .insert({
      user_id: userId,
      title: r.title,
      description: r.description,
      ingredients: r.ingredients,
      steps: r.steps,
      servings: r.servings,
      time_total_min: r.time_total_min,
      time_active_min: r.time_active_min,
      tags,
      cuisine: r.cuisine,
      course: r.course,
      season: r.season,
      occasion: r.occasion,
      main_ingredients: r.main_ingredients,
      source_type: "manual",
      source_url: null,
      source_name: r.source_name ?? "Night Kitchen",
      image_url: null,
      status: "want_to_try",
      capture_status: "ready",
      capture_gaps: r.gaps,
      raw_capture: { type: "invented" },
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ recipe });
}
