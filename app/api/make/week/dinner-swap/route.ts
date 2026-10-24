import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { currentUserId } from "@/lib/auth";
import { WeekDinnerSwapSchema, WeekOutlineSchema } from "@/lib/schemas";
import { WEEK_DINNER_SWAP_SYSTEM } from "@/lib/prompts/cook";
import { settleNights } from "@/lib/weekPlan";

export const maxDuration = 120;

const Body = z.object({
  request: z.string().trim().min(1).max(500),
  outline: WeekOutlineSchema,
  night: z.number().int().positive(),
  hint: z.string().trim().max(200).default(""),
  people: z.number().int().min(1).max(12),
});

/**
 * POST /api/make/week/dinner-swap — before the week is confirmed, replace one
 * dinner card. Just the card: no prep and no recipe exist yet, so it's quick.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Which night?" }, { status: 400 });
  const { request, outline, night, hint, people } = parsed.data;
  if (!outline.nights.some((n) => n.night === night)) {
    return NextResponse.json({ error: "Which night?" }, { status: 400 });
  }

  const { data: staples } = await db().from("staples").select("name").eq("user_id", userId).eq("active", true);

  const result = await askJson({
    feature: "week_dinner_swap",
    userId,
    model: MODELS.smart,
    system: WEEK_DINNER_SWAP_SYSTEM,
    content: JSON.stringify({
      request,
      nights: outline.nights,
      replace: night,
      hint,
      people,
      prep_days: outline.prep_days,
      staples: (staples ?? []).map((s) => s.name),
    }),
    schema: WeekDinnerSwapSchema,
    maxTokens: 1500,
    effort: "low",
  });

  // Settle the whole week with the new card in its slot, then hand back that slot.
  const labels = outline.nights.map((n) => n.label);
  const nights = outline.nights.map((n) => (n.night === night ? { ...result.night, night } : n));
  const settled = settleNights(nights, labels, outline.prep_days);
  return NextResponse.json({ night: settled[night - 1] });
}
