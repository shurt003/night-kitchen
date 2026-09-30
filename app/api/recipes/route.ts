import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";

/**
 * GET /api/recipes
 * Filters: status, tag, cuisine, max_active (minutes), max_effort, season
 * Sorts: recent (default) | rated | uncooked | most_cooked
 */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const p = url.searchParams;
  const supabase = db();

  let query = supabase
    .from("recipes")
    .select("*, cook_log(cooked_on)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (p.get("status")) query = query.eq("status", p.get("status"));
  if (p.get("tag")) query = query.contains("tags", [p.get("tag")]);
  if (p.get("cuisine")) query = query.eq("cuisine", p.get("cuisine"));
  if (p.get("season")) query = query.contains("season", [p.get("season")]);
  if (p.get("max_active")) query = query.lte("time_active_min", Number(p.get("max_active")));
  if (p.get("max_effort")) query = query.lte("effort", Number(p.get("max_effort")));

  const { data, error } = await query.limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    hearts: number | null;
    cook_log?: { cooked_on: string }[];
    [key: string]: unknown;
  };
  const rows = ((data ?? []) as Row[]).map((r) => {
    const cooks = r.cook_log ?? [];
    const lastCooked = cooks.length
      ? cooks.map((c: { cooked_on: string }) => c.cooked_on).sort().at(-1)!
      : null;
    return { ...r, cook_log: undefined, times_cooked: cooks.length, last_cooked: lastCooked };
  });

  const sort = p.get("sort") ?? "recent";
  if (sort === "rated") {
    rows.sort((a, b) => (b.hearts ?? 0) - (a.hearts ?? 0));
  } else if (sort === "uncooked") {
    rows.sort((a, b) => (a.last_cooked ?? "0000").localeCompare(b.last_cooked ?? "0000"));
  } else if (sort === "most_cooked") {
    rows.sort((a, b) => b.times_cooked - a.times_cooked);
  }

  return NextResponse.json({ recipes: rows });
}
