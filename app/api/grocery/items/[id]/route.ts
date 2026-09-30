import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeName } from "@/lib/grocery";
import { GROCERY_SECTIONS, GrocerySection } from "@/lib/config";
import { currentUserId } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/grocery/items/[id]
 * { checked } — check off / uncheck
 * { section } — hand-correct the section; the correction persists for that item name
 * { name, quantity } — edits
 */
export async function PATCH(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const supabase = db();

  const patch: Record<string, unknown> = {};
  if (typeof body.checked === "boolean") patch.checked = body.checked;
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.quantity === "string") patch.quantity = body.quantity;
  if (typeof body.section === "string" && (GROCERY_SECTIONS as readonly string[]).includes(body.section)) {
    patch.section = body.section as GrocerySection;
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: item, error } = await supabase
    .from("grocery_items")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Persist section corrections, keyed by canonical name so the fix applies
  // to every spelling of the same ingredient
  if (patch.section && item) {
    await supabase.from("item_section_prefs").upsert({
      name: item.canonical_name ?? normalizeName(item.name),
      section: patch.section,
      updated_at: new Date().toISOString(),
    });
  }
  return NextResponse.json({ item });
}

export async function DELETE(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { error } = await db().from("grocery_items").delete().eq("id", id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
