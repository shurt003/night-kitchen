import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { currentUserId } from "@/lib/auth";
import { ExtractionSchema, MakeSwapSchema } from "@/lib/schemas";
import { MAKE_SWAP_SYSTEM } from "@/lib/prompts/cook";

export const maxDuration = 300;

const BodySchema = z.object({
  request: z.string().trim().min(1).max(500),
  dishes: z.array(ExtractionSchema).min(2).max(4),
  index: z.number().int().min(0),
  hint: z.string().trim().max(200).default(""),
  servings: z.number().int().positive().max(50),
  max_active_min: z.number().int().positive().nullable().default(null),
});

/**
 * POST /api/make/swap — replace one dish of a meal ("give me a different
 * side") and rewrite the game plan around it. The other dishes go in as
 * context only — they come back untouched because they never come back at all.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success || parsed.data.index >= parsed.data.dishes.length) {
    return NextResponse.json({ error: "Which dish?" }, { status: 400 });
  }
  const { request, dishes, index, hint, servings, max_active_min } = parsed.data;

  const { data: staples } = await db().from("staples").select("name").eq("user_id", userId).eq("active", true);

  // What the plan needs to know about each dish — not the ingredient lists,
  // which would double the prompt for no gain in the timing.
  const meal = dishes.map((d) => ({
    title: d.title,
    course: d.course,
    description: d.description,
    time_total_min: d.time_total_min,
    time_active_min: d.time_active_min,
    steps: d.steps.map((s) => s.text),
  }));

  const result = await askJson({
    feature: "make_swap",
    userId,
    model: MODELS.smart,
    system: MAKE_SWAP_SYSTEM,
    content: JSON.stringify({
      request,
      meal,
      replace: index,
      hint,
      servings,
      max_active_min,
      staples: (staples ?? []).map((s) => s.name),
    }),
    schema: MakeSwapSchema,
    maxTokens: 8000,
    effort: "medium",
  });

  const dish = {
    ...result.dish,
    tags: result.dish.tags.includes("make") ? result.dish.tags : ["make", ...result.dish.tags],
    source_name: result.dish.source_name ?? "Night Kitchen",
  };
  return NextResponse.json({ dish, game_plan: result.game_plan });
}
