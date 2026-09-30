import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { MODELS, COURSES } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { currentUserId } from "@/lib/auth";

export const maxDuration = 120;

/**
 * POST /api/recipes/backfill-course — one-time classification of existing
 * recipes that predate the course field.
 *
 * Throwaway: it only touches rows where course is null, in small batches, so
 * it's safe to run repeatedly until it reports `remaining: 0`. Delete the route
 * once the library is done. New captures classify themselves, so this never
 * runs on anything created after the feature shipped.
 */
const BATCH = 15;

const ClassifySchema = z.object({
  results: z.array(z.object({ id: z.string(), course: z.enum(COURSES).catch("misc") })),
});

const SYSTEM = `You sort recipes into one course each. For every recipe you're given, return its id and one of: "meals" (a main / the main event), "appetizers" (starters, dips, small bites), "sides" (served alongside a main — vegetables, grains, salads, breads), "desserts" (anything sweet), "drinks" (cocktails, smoothies, anything you drink), or "misc" (fits none — sauces, snacks, condiments). Pick the single best fit.

Respond with ONLY JSON: { "results": [{ "id": "<id>", "course": "<course>" }] } — one entry per recipe, using the ids given.`;

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = db();

  const { data: rows } = await supabase
    .from("recipes")
    .select("id, title, description, main_ingredients, tags")
    .eq("user_id", userId)
    .is("course", null)
    .eq("capture_status", "ready")
    .limit(BATCH);

  if (!rows || rows.length === 0) {
    return NextResponse.json({ classified: 0, remaining: 0, done: true });
  }

  const result = await askJson({
    feature: "backfill_course",
    userId,
    model: MODELS.fast,
    system: SYSTEM,
    content: JSON.stringify(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        main: r.main_ingredients,
        tags: r.tags,
      }))
    ),
    schema: ClassifySchema,
    maxTokens: 2048,
  });

  // Only write ids we actually sent, so a hallucinated id can't touch another row.
  const sent = new Set(rows.map((r) => r.id));
  let classified = 0;
  for (const { id, course } of result.results) {
    if (!sent.has(id)) continue;
    await supabase.from("recipes").update({ course }).eq("id", id).eq("user_id", userId);
    classified++;
  }

  // Anything the model dropped from its response would loop forever otherwise;
  // sweep the batch's leftovers into misc so `remaining` always shrinks.
  const answered = new Set(result.results.map((r) => r.id));
  for (const r of rows) {
    if (!answered.has(r.id)) {
      await supabase.from("recipes").update({ course: "misc" }).eq("id", r.id).eq("user_id", userId);
      classified++;
    }
  }

  const { count } = await supabase
    .from("recipes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("course", null)
    .eq("capture_status", "ready");

  return NextResponse.json({ classified, remaining: count ?? 0, done: (count ?? 0) === 0 });
}
