import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateOpenTrip } from "@/lib/grocery";
import { currentUserId } from "@/lib/auth";

/**
 * POST /api/grocery/clear — empty the open trip in one call.
 * Body: { ids?: string[] } to limit it to specific rows.
 *
 * The trip itself stays open: clearing means "I typed this wrong / I'm starting
 * over", not "I've finished shopping" — that's what archiving is for.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const supabase = db();
  const trip = await getOrCreateOpenTrip(userId);

  // An explicit (even empty) id list means "only these". Clearing everything
  // requires omitting `ids` entirely — otherwise a list whose rows haven't
  // synced yet would send [] and wipe the server copy.
  if (Array.isArray(body.ids) && body.ids.length === 0) {
    return NextResponse.json({ cleared: 0 });
  }
  let query = supabase.from("grocery_items").delete().eq("user_id", userId).eq("trip_id", trip.id);
  if (Array.isArray(body.ids)) query = query.in("id", body.ids);
  const { data, error } = await query.select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ cleared: data?.length ?? 0 });
}
