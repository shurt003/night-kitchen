import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateOpenTrip } from "@/lib/grocery";
import { currentUserId } from "@/lib/auth";

/** GET /api/grocery/trip — the open trip with its items (creates one if none). */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const trip = await getOrCreateOpenTrip(userId);
  const { data: items, error } = await db()
    .from("grocery_items")
    .select("*")
    .eq("user_id", userId)
    .eq("trip_id", trip.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trip, items: items ?? [] });
}
