import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nextSunday } from "@/lib/grocery";
import { currentUserId } from "@/lib/auth";

/**
 * POST /api/grocery/archive
 * Body: { carry_over_ids: string[] } — unchecked items to carry to the next trip.
 * Archives the open trip; a new one opens automatically with next Sunday's date.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const carryOverIds: string[] = Array.isArray(body.carry_over_ids) ? body.carry_over_ids : [];
  const supabase = db();

  const { data: open } = await supabase
    .from("grocery_trips")
    .select("id, shop_date")
    .eq("user_id", userId)
    .eq("status", "open")
    .maybeSingle();
  if (!open) return NextResponse.json({ error: "No open trip" }, { status: 400 });

  const { data: toCarry } = carryOverIds.length
    ? await supabase.from("grocery_items").select("*").eq("user_id", userId).in("id", carryOverIds).eq("trip_id", open.id)
    : { data: [] };

  // Archive first (frees the unique open-trip slot), then open the next trip.
  const { error: archiveError } = await supabase
    .from("grocery_trips")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", open.id)
    .eq("user_id", userId);
  if (archiveError) return NextResponse.json({ error: archiveError.message }, { status: 500 });

  const base = new Date(open.shop_date + "T12:00:00");
  base.setDate(base.getDate() + 1); // strictly after the archived trip's Sunday
  const { data: next, error: createError } = await supabase
    .from("grocery_trips")
    .insert({ shop_date: nextSunday(base), user_id: userId })
    .select()
    .single();
  if (createError) return NextResponse.json({ error: createError.message }, { status: 500 });

  const carried = [];
  for (const item of toCarry ?? []) {
    const { data: created } = await supabase
      .from("grocery_items")
      .insert({
        user_id: userId,
        trip_id: next.id,
        name: item.name,
        canonical_name: item.canonical_name,
        quantity: item.quantity,
        section: item.section,
        source_type: item.source_type,
        source_id: item.source_id,
        sources: item.sources,
        carried_over_from: item.id,
      })
      .select()
      .single();
    if (created) carried.push(created);
  }

  return NextResponse.json({ archived_trip_id: open.id, trip: next, carried });
}
