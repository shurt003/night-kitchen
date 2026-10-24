import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { currentUserId } from "@/lib/auth";
import { WeekDinnersSchema } from "@/lib/schemas";
import { WEEK_DINNERS_SYSTEM } from "@/lib/prompts/cook";
import { DAY_NAMES, settleNights, weekFrame } from "@/lib/weekPlan";

export const maxDuration = 300;

const Body = z.object({
  request: z.string().trim().min(1).max(500),
  nights: z.number().int().min(3).max(7),
  people: z.number().int().min(1).max(12),
  prep_days: z.array(z.enum(DAY_NAMES)).max(7).default([]),
  /** The cook's local weekday (0 = Sunday), so labels match their week, not the server's. */
  today_dow: z.number().int().min(0).max(6).nullable().default(null),
});

/**
 * POST /api/make/week/dinners — Plan the week, step one: the dinner cards for
 * the cook to look over, swap and confirm. The prep and the recipes come only
 * after they confirm (/api/make/week/prep, then /api/make/week/recipe).
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Tell me about the week." }, { status: 400 });
  const { request, nights, people, prep_days, today_dow } = parsed.data;
  const { labels, prepDays } = weekFrame(nights, prep_days, today_dow);

  const { data: staples } = await db().from("staples").select("name").eq("user_id", userId).eq("active", true);

  const plan = await askJson({
    feature: "week_dinners",
    userId,
    model: MODELS.smart,
    system: WEEK_DINNERS_SYSTEM,
    content: JSON.stringify({
      request,
      nights,
      night_labels: labels,
      people,
      prep_days: prepDays,
      staples: (staples ?? []).map((s) => s.name),
    }),
    schema: WeekDinnersSchema,
    maxTokens: 4000,
    effort: "medium",
  });

  if (plan.nights.length < nights) {
    return NextResponse.json({ error: "That plan came back short — try again." }, { status: 502 });
  }
  return NextResponse.json({
    outline: {
      title: plan.title,
      components: [],
      nights: settleNights(plan.nights, labels, prepDays),
      prep_sessions: [],
      prep_days: prepDays,
      prep_plan: null,
      prep_day: null,
    },
  });
}
