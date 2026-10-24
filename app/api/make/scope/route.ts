import { NextResponse } from "next/server";
import { MODELS } from "@/lib/config";
import { askJson } from "@/lib/anthropic";
import { currentUserId } from "@/lib/auth";
import { MakeScopeSchema } from "@/lib/schemas";
import { MAKE_SCOPE_SYSTEM } from "@/lib/prompts/cook";

export const maxDuration = 60;

/**
 * POST /api/make/scope — the quick read before Make writes anything: one dish
 * or a meal, which dishes, and whether servings need asking (they do, unless
 * the request says or the dish has a natural batch size). On the fast model,
 * because the cook is waiting on it before the real wait even starts.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const request = String(body.request ?? "").trim().slice(0, 500);
  if (!request) return NextResponse.json({ error: "Tell me what you want to make." }, { status: 400 });

  const scope = await askJson({
    feature: "make_scope",
    userId,
    model: MODELS.fast,
    system: MAKE_SCOPE_SYSTEM,
    content: JSON.stringify({ request, whole_meal: !!body.whole_meal }),
    schema: MakeScopeSchema,
    maxTokens: 600,
  });

  if (scope.not_food) {
    return NextResponse.json(
      { error: "That doesn't sound like something to cook — try a dish or a meal." },
      { status: 422 }
    );
  }
  return NextResponse.json({ scope });
}
