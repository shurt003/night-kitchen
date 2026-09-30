import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";

/**
 * POST /api/grocery/archive/undo — reverse a just-archived trip.
 * Body: { archived_trip_id, new_trip_id }
 * Deletes the auto-opened next trip (cascading its carried-over copies) and
 * reopens the archived one. Powers the undo toast; safe because it only runs
 * within seconds of the archive.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { archived_trip_id: archivedId, new_trip_id: newId } = body;
  if (!archivedId || !newId) {
    return NextResponse.json({ error: "archived_trip_id and new_trip_id required" }, { status: 400 });
  }
  const supabase = db();

  const { data: archived } = await supabase
    .from("grocery_trips")
    .select("id, status")
    .eq("id", archivedId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!archived || archived.status !== "archived") {
    return NextResponse.json({ error: "Trip is not archived" }, { status: 400 });
  }

  // Delete the replacement trip first to free the single-open-trip slot.
  const { error: deleteError } = await supabase
    .from("grocery_trips")
    .delete()
    .eq("id", newId)
    .eq("user_id", userId)
    .eq("status", "open");
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  const { data: reopened, error: reopenError } = await supabase
    .from("grocery_trips")
    .update({ status: "open", archived_at: null })
    .eq("id", archivedId)
    .eq("user_id", userId)
    .select()
    .single();
  if (reopenError) return NextResponse.json({ error: reopenError.message }, { status: 500 });

  return NextResponse.json({ trip: reopened });
}
