import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { currentUserId } from "@/lib/auth";
import { WeekOutlineSchema } from "@/lib/schemas";
import { WEEK_OUTLINE_SYSTEM } from "@/lib/prompts/cook";
import { nightLabels } from "@/lib/weekPlan";

export const maxDuration = 300;

const Body = z.object({
  request: z.string().trim().min(1).max(500),
  nights: z.number().int().min(3).max(7),
  people: z.number().int().min(1).max(12),
  prep_day: z.enum(["Sat", "Sun"]).nullable().default(null),
  /** The cook's local weekday (0 = Sunday), so labels match their week, not the server's. */
  today_dow: z.number().int().min(0).max(6).nullable().default(null),
});

/**
 * POST /api/make/week/outline — Plan the week, step one: the whole stretch
 * planned before anything is written (bulk components, each night, how the
 * leftovers travel, the prep session). The page then writes every recipe in
 * parallel against this.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Tell me about the week." }, { status: 400 });
  const { request, nights, people, prep_day, today_dow } = parsed.data;

  const today = new Date();
  if (today_dow !== null) today.setDate(today.getDate() + ((today_dow - today.getDay() + 7) % 7));
  const labels = nightLabels(nights, prep_day, today);

  const { data: staples } = await db().from("staples").select("name").eq("user_id", userId).eq("active", true);

  const outline = await askJson({
    feature: "week_outline",
    userId,
    model: MODELS.smart,
    system: WEEK_OUTLINE_SYSTEM,
    content: JSON.stringify({
      request,
      nights,
      night_labels: labels,
      people,
      prep_day,
      staples: (staples ?? []).map((s) => s.name),
    }),
    schema: WeekOutlineSchema,
    maxTokens: 6000,
    effort: "medium",
  });

  // Hold the model to the shape asked for: exactly `nights` nights, in order,
  // under our labels — and drop component references that point nowhere.
  const keys = new Set(outline.components.map((c) => c.key));
  const fixedNights = outline.nights.slice(0, nights).map((n, i) => ({
    ...n,
    night: i + 1,
    label: labels[i],
    uses: n.uses.filter((k) => keys.has(k)),
    from_night: n.from_night && n.from_night < i + 1 ? n.from_night : null,
    kind: n.kind !== "cook" && !(n.from_night && n.from_night < i + 1) ? ("cook" as const) : n.kind,
  }));
  if (fixedNights.length < nights) {
    return NextResponse.json({ error: "That plan came back short — try again." }, { status: 502 });
  }
  return NextResponse.json({ outline: { ...outline, nights: fixedNights, prep_day }, labels });
}
