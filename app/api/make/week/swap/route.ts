import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { currentUserId } from "@/lib/auth";
import { WeekOutlineSchema, WeekSwapSchema } from "@/lib/schemas";
import { WEEK_SWAP_SYSTEM } from "@/lib/prompts/cook";

export const maxDuration = 300;

const Body = z.object({
  request: z.string().trim().min(1).max(500),
  outline: WeekOutlineSchema,
  night: z.number().int().positive(),
  hint: z.string().trim().max(200).default(""),
  people: z.number().int().min(1).max(12),
});

/**
 * POST /api/make/week/swap — replace one night of a planned week, and only
 * that night: its new outline entry plus its recipe (none for a plain reheat).
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Which night?" }, { status: 400 });
  const { request, outline, night, hint, people } = parsed.data;
  const current = outline.nights.find((n) => n.night === night);
  if (!current) return NextResponse.json({ error: "Which night?" }, { status: 400 });

  const { data: staples } = await db().from("staples").select("name").eq("user_id", userId).eq("active", true);

  const result = await askJson({
    feature: "week_swap",
    userId,
    model: MODELS.smart,
    system: WEEK_SWAP_SYSTEM,
    content: JSON.stringify({
      request,
      outline,
      replace: night,
      hint,
      people,
      staples: (staples ?? []).map((s) => s.name),
    }),
    schema: WeekSwapSchema,
    maxTokens: 7000,
    effort: "medium",
  });

  // Keep the slot: same night number and label; only known components; a
  // leftovers night must point at an earlier night.
  const keys = new Set(outline.components.map((c) => c.key));
  const from = result.night.from_night && result.night.from_night < night ? result.night.from_night : null;
  const entry = {
    ...result.night,
    night,
    label: current.label,
    uses: result.night.uses.filter((k) => keys.has(k)),
    from_night: from,
    kind: result.night.kind !== "cook" && !from ? ("cook" as const) : result.night.kind,
  };
  const recipe =
    entry.kind === "reheat" || !result.recipe
      ? null
      : {
          ...result.recipe,
          tags: result.recipe.tags.includes("make") ? result.recipe.tags : ["make", ...result.recipe.tags],
          source_name: result.recipe.source_name ?? "Night Kitchen",
        };
  return NextResponse.json({ night: entry, recipe });
}
