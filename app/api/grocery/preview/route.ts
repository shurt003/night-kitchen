import { NextResponse } from "next/server";
import {
  annotateOwned,
  candidatesForPlannedMeal,
  candidatesForRecipe,
  type Candidate,
} from "@/lib/candidates";
import { currentUserId } from "@/lib/auth";

/**
 * POST /api/grocery/preview
 * Body: { recipe_id } | { planned_meal_id } | { planned_meal_ids: [] }
 *
 * What *would* be added, annotated with whether you likely already have it.
 * Nothing is written — the user confirms first, so an item is never silently
 * withheld.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  let candidates: Candidate[] = [];

  if (body.recipe_id) {
    candidates = await candidatesForRecipe(userId, body.recipe_id);
  } else if (body.planned_meal_id) {
    candidates = await candidatesForPlannedMeal(userId, body.planned_meal_id);
  } else if (Array.isArray(body.planned_meal_ids)) {
    const lists = await Promise.all(
      body.planned_meal_ids.map((id: string) => candidatesForPlannedMeal(userId, id))
    );
    candidates = lists.flat();
  } else {
    return NextResponse.json({ error: "Nothing to preview" }, { status: 400 });
  }

  return NextResponse.json({ items: await annotateOwned(userId, candidates) });
}
