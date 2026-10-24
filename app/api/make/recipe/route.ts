import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { currentUserId } from "@/lib/auth";
import { MakeRecipeSchema, MakeScopeSchema } from "@/lib/schemas";
import { MAKE_RECIPE_SYSTEM } from "@/lib/prompts/cook";

// A whole meal is several full recipes in one answer — the longest write in
// the app, so it gets the most headroom.
export const maxDuration = 300;

/**
 * POST /api/make/recipe — write what was asked for: one recipe, or a meal's
 * recipes plus a game plan. Body: { request, scope, servings, max_active_min }.
 *
 * Nothing is written to the database — the dishes live in client state as
 * drafts until saved, the same as Wing it's invented recipes.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const request = String(body.request ?? "").trim().slice(0, 500);
  const scope = MakeScopeSchema.safeParse(body.scope);
  if (!request || !scope.success) {
    return NextResponse.json({ error: "Tell me what you want to make." }, { status: 400 });
  }

  // A number the cook gave — tapped, or in their words ("lasagna for 6") —
  // beats a dish's natural batch, so the batch label only applies when they
  // named none. The page asks before calling when there's neither, so landing
  // on 4 here means a client bug; cook something rather than fail.
  const asked = Number(body.servings);
  const named =
    (Number.isInteger(asked) && asked > 0 && asked <= 50 ? asked : null) ??
    scope.data.servings_in_request;
  const yieldInfo = named ? null : scope.data.standard_yield;
  const servings = named ?? yieldInfo?.servings ?? 4;
  const maxActive = Number.isFinite(Number(body.max_active_min)) && body.max_active_min !== null
    ? Number(body.max_active_min)
    : null;

  const { data: staples } = await db().from("staples").select("name").eq("user_id", userId).eq("active", true);

  const meal = scope.data.kind === "meal";
  const result = await askJson({
    feature: "make_recipe",
    userId,
    model: MODELS.smart,
    system: MAKE_RECIPE_SYSTEM,
    content: JSON.stringify({
      request,
      kind: scope.data.kind,
      dishes: scope.data.dishes,
      servings,
      yield_label: yieldInfo?.label ?? null,
      max_active_min: maxActive,
      staples: (staples ?? []).map((s) => s.name),
    }),
    schema: MakeRecipeSchema,
    // One recipe fits comfortably in what Wing it gets; a meal is up to four.
    maxTokens: meal ? 16000 : 6000,
    // Same trade as Wing it's recipe: it has to actually work, but the cook is
    // waiting on it.
    effort: "medium",
  });

  // "make" marks where a saved recipe came from; the save route adds
  // "generated" on top. A single dish has no game plan to show.
  const dishes = result.dishes.map((d) => ({
    ...d,
    tags: d.tags.includes("make") ? d.tags : ["make", ...d.tags],
    source_name: d.source_name ?? "Night Kitchen",
  }));
  return NextResponse.json({
    dishes,
    game_plan: meal && result.game_plan?.length ? result.game_plan : null,
    servings,
  });
}
