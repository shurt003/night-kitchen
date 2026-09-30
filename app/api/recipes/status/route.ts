import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";

/**
 * GET /api/recipes/status?ids=a,b — capture status only.
 *
 * The library polls every 2.5s while a capture is processing; fetching the
 * full list (every ingredient of every recipe) to watch one skeleton turn
 * into one card was megabytes per capture. This is a few dozen bytes.
 */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (!ids.length) return NextResponse.json({ statuses: [] });

  const { data, error } = await db()
    .from("recipes")
    .select("id, capture_status")
    .eq("user_id", userId)
    .in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ statuses: data ?? [] });
}
