import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { GROCERY_SECTIONS } from "@/lib/config";
import { addItemsToOpenTrip } from "@/lib/grocery";
import { currentUserId } from "@/lib/auth";

/**
 * GET /api/staples — the standing list, with anything overdue first.
 * A staple is "due" when typical_cadence_days has elapsed since last_added.
 */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await db()
    .from("staples")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true)
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date();
  const staples = (data ?? []).map((s) => {
    let dueInDays: number | null = null;
    if (s.typical_cadence_days) {
      const since = s.last_added
        ? Math.floor(
            (today.getTime() - new Date(s.last_added + "T12:00:00").getTime()) / 86400000
          )
        : 9999;
      dueInDays = s.typical_cadence_days - since;
    }
    return { ...s, due_in_days: dueInDays, overdue: dueInDays !== null && dueInDays <= 0 };
  });

  // Overdue first — that's the point of the cadence (§5).
  staples.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (a.due_in_days ?? 9999) - (b.due_in_days ?? 9999);
  });

  return NextResponse.json({ staples });
}

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const section = (GROCERY_SECTIONS as readonly string[]).includes(body.section)
    ? body.section
    : "other";

  const { data, error } = await db()
    .from("staples")
    .insert({
      user_id: userId,
      name,
      section,
      typical_cadence_days: body.typical_cadence_days ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staple: data });
}

/**
 * PUT /api/staples — the restock pass: { ids: [] } adds those staples to the
 * open trip and stamps last_added. A checklist, not a memory test.
 */
export async function PUT(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
  const supabase = db();

  const { data: staples } = await supabase.from("staples").select("*").eq("user_id", userId).in("id", ids);
  if (!staples?.length) return NextResponse.json({ error: "No staples found" }, { status: 404 });

  const result = await addItemsToOpenTrip(
    userId,
    staples.map((s) => ({
      name: s.name,
      section: s.section,
      source_type: "staple" as const,
      source_id: s.id,
      source_label: "staple",
    }))
  );

  const today = new Date().toISOString().slice(0, 10);
  await supabase.from("staples").update({ last_added: today }).eq("user_id", userId).in("id", ids);

  return NextResponse.json(result);
}
