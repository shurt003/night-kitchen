import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { currentUserId } from "@/lib/auth";
import { ExtractionSchema, WeekOutlineSchema } from "@/lib/schemas";
import { WEEK_RECIPE_SYSTEM } from "@/lib/prompts/cook";

export const maxDuration = 300;

const Body = z.object({
  request: z.string().trim().min(1).max(500),
  outline: WeekOutlineSchema,
  people: z.number().int().min(1).max(12),
  write: z.union([z.object({ component: z.string() }), z.object({ night: z.number().int().positive() })]),
});

/**
 * POST /api/make/week/recipe — Plan the week, step two: write ONE recipe (a
 * bulk component or a night's dinner) against the outline. The page calls this
 * for every item at once, so a whole week lands in about the time one recipe
 * takes.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Which recipe?" }, { status: 400 });
  const { request, outline, people, write } = parsed.data;

  const isComponent = "component" in write;
  const target = isComponent
    ? outline.components.find((c) => c.key === write.component)
    : outline.nights.find((n) => n.night === write.night);
  if (!target) return NextResponse.json({ error: "Which recipe?" }, { status: 400 });

  const { data: staples } = await db().from("staples").select("name").eq("user_id", userId).eq("active", true);

  const recipe = await askJson({
    feature: isComponent ? "week_component" : "week_night",
    userId,
    model: MODELS.smart,
    system: WEEK_RECIPE_SYSTEM,
    content: JSON.stringify({
      request,
      outline,
      people,
      staples: (staples ?? []).map((s) => s.name),
      write,
    }),
    schema: ExtractionSchema,
    maxTokens: 6000,
    effort: "medium",
  });

  return NextResponse.json({
    recipe: {
      ...recipe,
      tags: recipe.tags.includes("make") ? recipe.tags : ["make", ...recipe.tags],
      source_name: recipe.source_name ?? "Night Kitchen",
    },
  });
}
