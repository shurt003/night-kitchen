import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addItemsToOpenTrip, getOrCreateOpenTrip, NewItem } from "@/lib/grocery";
import { normalizeName } from "@/lib/groceryShared";
import { GROCERY_SECTIONS } from "@/lib/config";
import {
  candidatesForPlannedMeal,
  candidatesForRecipe,
  type Candidate,
} from "@/lib/candidates";
import { currentUserId } from "@/lib/auth";

/**
 * POST /api/grocery/items
 * Body: { items: [{name, quantity?}] }        — manual add (the fastest path)
 *    or { recipe_id }                         — a recipe's ingredients
 *    or { planned_meal_id }                   — any filled planner slot
 *    or { planned_meal_ids: [] }              — the Sunday bulk add
 *    or { full_items: [...] }                 — verbatim insert (undo / offline sync)
 *
 * Add-from-source calls accept `only: string[]` — the names the user confirmed.
 * Source attribution is preserved either way, so dropping a meal can still pull
 * exactly its items back out.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  if (Array.isArray(body.full_items) && body.full_items.length) {
    const trip = await getOrCreateOpenTrip(userId);
    const supabase = db();
    const added = [];
    for (const f of body.full_items) {
      if (!f?.name?.trim()) continue;
      const { data: created } = await supabase
        .from("grocery_items")
        .insert({
          user_id: userId,
          trip_id: trip.id,
          name: String(f.name).trim(),
          canonical_name: f.canonical_name ?? null,
          quantity: typeof f.quantity === "string" ? f.quantity : "",
          section: (GROCERY_SECTIONS as readonly string[]).includes(f.section) ? f.section : "other",
          checked: !!f.checked,
          source_type: f.source_type ?? "manual",
          source_id: f.source_id ?? null,
          sources: Array.isArray(f.sources) ? f.sources : [],
          carried_over_from: f.carried_over_from ?? null,
        })
        .select()
        .single();
      if (created) added.push(created);
    }
    return NextResponse.json({ trip, added, merged: [] });
  }

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
  }

  let items: NewItem[] = [];

  if (candidates.length) {
    if (Array.isArray(body.only)) {
      const keep = new Set(body.only.map((n: string) => normalizeName(n)));
      candidates = candidates.filter((c) => keep.has(normalizeName(c.name)));
    }
    items = candidates.map((c) => ({
      name: c.name,
      quantity: c.quantity,
      source_type: c.source_type,
      source_id: c.source_id,
      source_label: c.source_label,
    }));
  } else if (Array.isArray(body.items) && body.items.length) {
    items = body.items
      .filter((i: { name?: string }) => i?.name?.trim())
      .map((i: { name: string; quantity?: string }) => ({
        name: i.name,
        quantity: i.quantity ?? "",
        source_type: "manual" as const,
      }));
  }

  if (!items.length) {
    return NextResponse.json({ error: "Nothing to add" }, { status: 400 });
  }

  return NextResponse.json(await addItemsToOpenTrip(userId, items));
}

/**
 * DELETE /api/grocery/items?recipe_id=...
 * Pull a dropped recipe's unchecked items back out. Manual items are never touched.
 */
export async function DELETE(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const recipeId = new URL(req.url).searchParams.get("recipe_id");
  if (!recipeId) return NextResponse.json({ error: "recipe_id required" }, { status: 400 });
  const supabase = db();
  const { data: removed, error } = await supabase
    .from("grocery_items")
    .delete()
    .eq("user_id", userId)
    .eq("source_type", "recipe")
    .eq("source_id", recipeId)
    .eq("checked", false)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ removed: removed?.length ?? 0 });
}
