import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { PantrySchema } from "@/lib/schemas";
import { PANTRY_SYSTEM } from "@/lib/prompts/cook";
import { buildRecipeIndex } from "@/lib/recipeIndex";
import { currentUserId } from "@/lib/auth";

export const maxDuration = 120;

/**
 * POST /api/pantry — "what can I make right now"
 * Staples are assumed on hand (§3), so this stays accurate without the user
 * inventorying their kitchen.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const onHand = String(body.on_hand ?? "").trim();
  if (!onHand) return NextResponse.json({ error: "Tell me what you have." }, { status: 400 });

  const maxActive = Number.isFinite(Number(body.max_active_min))
    ? Number(body.max_active_min)
    : null;

  const supabase = db();
  const [recipes, staplesRes] = await Promise.all([
    buildRecipeIndex(userId),
    supabase.from("staples").select("name").eq("user_id", userId).eq("active", true),
  ]);
  // Applied here rather than in the prompt: a hard filter always holds, costs
  // fewer tokens than asking, and can't be talked round. Recipes with no
  // recorded time are kept — unknown isn't the same as too long.
  const inTime =
    maxActive == null
      ? recipes
      : recipes.filter((r) => r.time_active == null || r.time_active <= maxActive);

  if (!inTime.length) {
    return NextResponse.json({ can_make_now: [], nearly: [], recipes: [] });
  }

  const result = await askJson({
    feature: "pantry",
    userId,
    model: MODELS.smart,
    system: PANTRY_SYSTEM,
    content: JSON.stringify({
      on_hand: onHand,
      staples: (staplesRes.data ?? []).map((s) => s.name),
      recipes: inTime,
    }),
    schema: PantrySchema,
    maxTokens: 2048,
    // Ranking an index against a list — no deliberation needed.
    effort: "low",
  });

  const ids = [
    ...result.can_make_now.map((r) => r.id),
    ...result.nearly.map((r) => r.id),
  ];
  const { data: full } = ids.length
    ? await supabase.from("recipes").select("*").eq("user_id", userId).in("id", ids)
    : { data: [] };

  return NextResponse.json({ ...result, recipes: full ?? [] });
}
