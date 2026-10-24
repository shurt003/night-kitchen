import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { currentUserId } from "@/lib/auth";
import { WeekOutlineSchema, WeekPrepSchema } from "@/lib/schemas";
import { WEEK_PREP_SYSTEM } from "@/lib/prompts/cook";

export const maxDuration = 300;

const Body = z.object({
  request: z.string().trim().min(1).max(500),
  outline: WeekOutlineSchema,
  people: z.number().int().min(1).max(12),
});

/**
 * POST /api/make/week/prep — Plan the week, on confirm: what each prep day
 * cooks for the approved dinners, and the session to cook it in. Returns the
 * full outline the recipes are then written against.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Which week?" }, { status: 400 });
  const { request, outline, people } = parsed.data;
  const prepDays = outline.prep_days;

  const { data: staples } = await db().from("staples").select("name").eq("user_id", userId).eq("active", true);

  const prep = await askJson({
    feature: "week_prep",
    userId,
    model: MODELS.smart,
    system: WEEK_PREP_SYSTEM,
    content: JSON.stringify({
      request,
      nights: outline.nights,
      people,
      prep_days: prepDays,
      staples: (staples ?? []).map((s) => s.name),
    }),
    schema: WeekPrepSchema,
    maxTokens: 5000,
    effort: "medium",
  });

  // Components cook on a chosen prep day (the first, if the model named
  // another); nights only reference components that exist; sessions only for
  // chosen days.
  const components = prep.components.map((c) => ({
    ...c,
    prep_day: prepDays.length ? (c.prep_day && prepDays.includes(c.prep_day) ? c.prep_day : prepDays[0]) : null,
    used_on: c.used_on.filter((n) => n >= 1 && n <= outline.nights.length),
  }));
  const keys = new Set(components.map((c) => c.key));
  const usesByNight = new Map(prep.uses.map((u) => [u.night, u.keys.filter((k) => keys.has(k))]));
  // A component lists its nights too — fold those in, so a night never misses one.
  for (const c of components) {
    for (const n of c.used_on) usesByNight.set(n, [...new Set([...(usesByNight.get(n) ?? []), c.key])]);
  }
  const sessions = prep.prep_sessions
    .filter((s) => s.plan.length)
    .map((s) => ({ ...s, day: prepDays.length ? (s.day && prepDays.includes(s.day) ? s.day : prepDays[0]) : null }));

  return NextResponse.json({
    outline: {
      ...outline,
      components,
      nights: outline.nights.map((n) => ({ ...n, uses: usesByNight.get(n.night) ?? [] })),
      prep_sessions: sessions,
    },
  });
}
