import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { currentUserId } from "@/lib/auth";
import { ExtractionSchema } from "@/lib/schemas";
import { INVENT_RECIPE_SYSTEM } from "@/lib/prompts/cook";

export const maxDuration = 120;

/**
 * POST /api/invent/recipe — expand one pitch into a full recipe.
 *
 * Returns an Extraction, the same shape capture produces, so the detail sheet
 * renders it unchanged and saving is the same field mapping runExtraction does.
 * Nothing is written here — the recipe lives in client state until saved.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const idea = body.idea;
  if (!idea || typeof idea !== "object" || !idea.title) {
    return NextResponse.json({ error: "Which idea?" }, { status: 400 });
  }
  const onHand = String(body.on_hand ?? "").trim();

  const { data: staples } = await db().from("staples").select("name").eq("user_id", userId).eq("active", true);

  const recipe = await askJson({
    feature: "invent_recipe",
    userId,
    model: MODELS.smart,
    system: INVENT_RECIPE_SYSTEM,
    content: JSON.stringify({
      idea,
      on_hand: onHand,
      staples: (staples ?? []).map((s) => s.name),
    }),
    schema: ExtractionSchema,
    maxTokens: 4096,
    // Longer output, and the recipe has to actually work — worth more than the
    // pitches get, less than the default.
    effort: "medium",
  });

  return NextResponse.json({ recipe });
}
